// The gitlab-work-items MCP server: Claude's bridge to GitLab Work Items, through glab.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import manifest from "../../plugins/gitlab-work-items/.claude-plugin/plugin.json" with { type: "json" };
import type { ToolName } from "../tool-names.js";
import { readConfig } from "./config.js";
import { connect } from "./gitlab.js";
import { Reader } from "./reader.js";
import { Seen } from "./seen.js";
import { Lookups } from "./lookups.js";
import { Planner } from "./writes/plan.js";
import { Writes, type Confirm } from "./writes/writes.js";
import { MAX_WRITES, WRITE_SCHEMA } from "./writes/requests.js";
import { FILTER_SCHEMA, Lists, PAGING_SCHEMA } from "./lists.js";
import { MINIMUM_GITLAB } from "./versions.js";
import { answer, guarded } from "./result.js";
import { status } from "./tools/status.js";
import { fetchWorkItem } from "./tools/fetch.js";
import { listAnswer, listWorkItems } from "./tools/list.js";
import { pickWorkItem, type PickOne } from "./tools/pick.js";

const gitlab = connect(readConfig());
const { config } = gitlab;
const reader = new Reader(gitlab);
const seen = new Seen();
const lists = new Lists(gitlab);
const lookups = new Lookups(gitlab.gateway);
const writes = new Writes(gitlab, reader, seen, new Planner(gitlab, reader, seen, lookups));

const server = new McpServer({ name: "gitlab-work-items", version: manifest.version });

/**
 * How long a dialog waits for the user. Claude Code waits on an open dialog without limit;
 * the SDK would give up after a minute, too soon to read a long preview.
 */
const DIALOG_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Asks the user directly through an MCP elicitation form: their answers when they accept,
 * undefined when they decline or cancel, or "unsupported" when the client can't show a form.
 */
async function askUser(
  message: string,
  fields: ElicitRequestFormParams["requestedSchema"]["properties"],
): Promise<Record<string, unknown> | undefined | "unsupported"> {
  if (!server.server.getClientCapabilities()?.elicitation) return "unsupported";
  const response = await server.server.elicitInput(
    { mode: "form", message, requestedSchema: { type: "object", properties: fields, required: Object.keys(fields) } },
    { timeout: DIALOG_TIMEOUT_MS },
  );
  return response.action === "accept" ? response.content : undefined;
}

const pickWithUser: PickOne = async (entries) => {
  const answers = await askUser("Pick a Work Item to open in full.", {
    workItem: {
      type: "string",
      title: "Work Item",
      oneOf: entries.map((entry) => ({ const: entry.reference, title: `${entry.reference} ${entry.title}` })),
    },
  });
  if (answers === "unsupported") return answers;
  return typeof answers?.workItem === "string" ? answers.workItem : undefined;
};

const confirmWithUser: Confirm = async (message, count) => {
  const answers = await askUser(message, {
    confirm: {
      type: "boolean",
      title: "Apply to GitLab",
      description: `Tick to send ${count === 1 ? "this Write" : `these ${count} Writes`} to GitLab.`,
      default: false,
    },
  });
  if (answers === "unsupported") return answers;
  return answers?.confirm === true;
};

server.registerTool(
  "status" satisfies ToolName,
  {
    title: "GitLab plugin status",
    description:
      `Shows the configured GitLab Instance, where the token comes from, glab's version, the GitLab version and edition, who the token signs in as, and whether GitLab ${MINIMUM_GITLAB} or later is met. Given a project, also runs read-only probes of the plugin's queries there.`,
    inputSchema: { project: z.string().optional().describe("A project's full path to run read-only probes in, e.g. acme/app") },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ project }) => status(gitlab, { lookups, lists, reader }, project)),
);

server.registerTool(
  "fetch_work_item" satisfies ToolName,
  {
    title: "Fetch a GitLab Work Item",
    description:
      "Fetches one GitLab Issue or Task live: a digest (fields, parent, children, Linked Items, Thread counts, associated merge requests) plus its full description and Threads. Pass a Work Item URL (a Comment link puts that Comment's Thread in focus) or a full reference such as group/project#12; resolve short references like #12 first.",
    inputSchema: { reference: z.string().describe("Work Item URL or full reference, e.g. group/project#12") },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ reference }) => fetchWorkItem(config, reader, seen, reference)),
);

server.registerTool(
  "list_work_items" satisfies ToolName,
  {
    title: "List GitLab Work Items",
    description:
      "Lists Issues and Tasks in a project or group (subgroups and projects included) as compact summaries, most recently updated first. Ask for more with limit or continue with after.",
    inputSchema: {
      fullPath: z.string().describe("Full path of the project or group, e.g. acme/app or acme"),
      ...PAGING_SCHEMA,
      ...FILTER_SCHEMA,
    },
    annotations: { readOnlyHint: true },
  },
  guarded(async (args) => listWorkItems(config, reader, lists, args)),
);

server.registerTool(
  "my_work_items" satisfies ToolName,
  {
    title: "List my GitLab Work Items",
    description:
      "Lists the signed-in user's Issues and Tasks across the whole Instance (assigned to them), open by default, most recently updated first.",
    inputSchema: {
      ...PAGING_SCHEMA,
      state: FILTER_SCHEMA.state,
      types: FILTER_SCHEMA.types,
      labels: FILTER_SCHEMA.labels,
      search: FILTER_SCHEMA.search,
    },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ limit, after, ...filters }) => listAnswer("Your Work Items", await lists.mine(filters, limit, after))),
);

server.registerTool(
  "pick_work_item" satisfies ToolName,
  {
    title: "Pick a GitLab Work Item to open",
    description:
      "Lists Issues and Tasks in a project or group with the same filters as list_work_items, lets the user pick one in a dialog, and returns the picked Work Item in full, as fetch_work_item does. Use it when the user wants to choose a Work Item to open; show the picked one to them in full.",
    inputSchema: {
      fullPath: z.string().describe("Full path of the project or group, e.g. acme/app or acme"),
      limit: PAGING_SCHEMA.limit,
      ...FILTER_SCHEMA,
    },
    annotations: { readOnlyHint: true },
  },
  guarded(async (args) => pickWorkItem(config, reader, seen, lists, pickWithUser, args)),
);

server.registerTool(
  "prepare_writes" satisfies ToolName,
  {
    title: "Prepare GitLab Writes",
    description:
      `Prepares up to ${MAX_WRITES} Writes to GitLab Work Items and returns a preview and a plan ID. Changes nothing: show the preview to the user, then call apply_writes with the plan ID only after they confirm.`,
    inputSchema: { writes: z.array(WRITE_SCHEMA).min(1) },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ writes: requests }) => {
    const { plan, preview } = await writes.prepare(requests);
    return answer(preview, { planId: plan.id, count: plan.writes.length });
  }),
);

server.registerTool(
  "apply_writes" satisfies ToolName,
  {
    title: "Apply prepared GitLab Writes",
    description:
      "Applies a plan from prepare_writes after the user confirms it. The only tool that changes GitLab. To leave out Writes the user dropped, list their numbers from the preview in drop.",
    inputSchema: {
      planId: z.string(),
      drop: z.array(z.number().int().min(1)).optional().describe("Preview numbers of Writes the user dropped"),
    },
    annotations: { destructiveHint: true },
    // Claude Code shows its permission prompt for this tool on every call, even under allow
    // rules or a permission mode that skips prompts. The write-guard hook asks as well.
    _meta: { "anthropic/requiresUserInteraction": true },
  },
  guarded(async ({ planId, drop }) => {
    const { results, report } = await writes.apply(planId, confirmWithUser, drop);
    return answer(report, { results });
  }),
);

await server.connect(new StdioServerTransport());
