// The gitlab-work-items MCP server: Claude's bridge to GitLab Work Items, through glab.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { Instance } from "./instance.js";
import { Reader } from "./reader.js";
import { Lookups } from "./lookups.js";
import { Writes, type Confirm } from "./writes/writes.js";
import { MAX_WRITES, WRITE_SCHEMA } from "./writes/requests.js";
import { DEFAULT_LIMIT, FILTER_SCHEMA, Lists, MAX_LIMIT } from "./lists.js";
import { answer, guarded } from "./result.js";
import { status } from "./tools/status.js";
import { fetchWorkItem } from "./tools/fetch.js";
import { listAnswer, listWorkItems } from "./tools/list.js";
import { z } from "zod";
import type { ToolName } from "../tool-names.js";

const config = readConfig();
const gateway = new Gateway(config);
const instance = new Instance(gateway);
const reader = new Reader(config, gateway, instance);
const lists = new Lists(config, gateway, instance);
const lookups = new Lookups(gateway);
const writes = new Writes(config, gateway, instance, reader, lookups);

const server = new McpServer({ name: "gitlab-work-items", version: "0.1.0" });

server.registerTool(
  "status" satisfies ToolName,
  {
    title: "GitLab plugin status",
    description:
      "Shows the configured GitLab Instance, where the token comes from, glab's version, the GitLab version and edition, who the token signs in as, and whether GitLab 18.1 or later is met. Given a project, also runs read-only probes of the plugin's queries there.",
    inputSchema: { project: z.string().optional().describe("A project's full path to run read-only probes in, e.g. acme/app") },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ project }) => status(config, gateway, instance, { lookups, lists, reader }, project)),
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
  guarded(async ({ reference }) => fetchWorkItem(config, reader, reference)),
);

server.registerTool(
  "list_work_items" satisfies ToolName,
  {
    title: "List GitLab Work Items",
    description:
      "Lists Issues and Tasks in a project or group (subgroups and projects included) as compact summaries, most recently updated first. 20 by default; ask for more with limit (up to 200) or continue with after.",
    inputSchema: {
      fullPath: z.string().describe("Full path of the project or group, e.g. acme/app or acme"),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`),
      after: z.string().optional().describe("Cursor from a previous list, to continue it"),
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
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`),
      after: z.string().optional().describe("Cursor from a previous list, to continue it"),
      state: FILTER_SCHEMA.state,
      types: FILTER_SCHEMA.types,
      labels: FILTER_SCHEMA.labels,
      search: FILTER_SCHEMA.search,
    },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ limit, after, ...filters }) => listAnswer("Your Work Items", await lists.mine(filters, limit, after))),
);

/** Asks the user directly through MCP elicitation, when the client supports it. */
const confirmWithUser: Confirm = async (preview) => {
  if (!server.server.getClientCapabilities()?.elicitation) return "unsupported";
  const response = await server.server.elicitInput({
    mode: "form",
    message: preview,
    requestedSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", title: "Apply to GitLab", description: "Tick to send these Writes to GitLab.", default: false },
      },
      required: ["confirm"],
    },
  });
  return response.action === "accept" && response.content?.confirm === true;
};


server.registerTool(
  "prepare_writes" satisfies ToolName,
  {
    title: "Prepare GitLab Writes",
    description: `Prepares up to ${MAX_WRITES} Writes to GitLab Work Items and returns a preview and a plan ID. Changes nothing: show the preview to the user, then call apply_writes with the plan ID only after they confirm.`,
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
  },
  guarded(async ({ planId, drop }) => {
    const { results, report } = await writes.apply(planId, confirmWithUser, drop);
    return answer(report, { results });
  }),
);

await server.connect(new StdioServerTransport());
