// The gitlab-work-items MCP server: Claude's bridge to GitLab Work Items, through glab.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { Instance } from "./instance.js";
import { Reader } from "./reader.js";
import { parseReference } from "./references.js";
import { DEFAULT_LIMIT, Lists, MAX_LIMIT } from "./lists.js";
import { guarded } from "./result.js";
import { status } from "./tools/status.js";
import { fetchWorkItem } from "./tools/fetch.js";
import { listAnswer } from "./tools/list.js";
import { z } from "zod";

const config = readConfig();
const gateway = new Gateway(config);
const instance = new Instance(gateway);
const reader = new Reader(config, gateway, instance);
const lists = new Lists(gateway, instance);

const FILTER_SCHEMA = {
  state: z.enum(["opened", "closed", "all"]).optional().describe("Default: opened"),
  types: z.array(z.enum(["Issue", "Task"])).optional().describe("Default: both"),
  assignees: z.array(z.string()).optional().describe("Usernames; every one must be assigned"),
  assignedToMe: z.boolean().optional().describe("Only Work Items assigned to the signed-in user"),
  author: z.string().optional().describe("Author's username"),
  labels: z.array(z.string()).optional().describe("Every one of these labels"),
  excludeLabels: z.array(z.string()).optional().describe("None of these labels"),
  anyLabels: z.array(z.string()).optional().describe("At least one of these labels"),
  milestone: z.string().optional().describe("Milestone title"),
  parent: z.string().optional().describe("The parent Work Item's URL or full reference, to list its children"),
  search: z.string().optional().describe("Text to find in titles and descriptions"),
};

const server = new McpServer({ name: "gitlab-work-items", version: "0.1.0" });

server.registerTool(
  "status",
  {
    title: "GitLab plugin status",
    description:
      "Shows the configured GitLab Instance, where the token comes from, the GitLab version and edition, who the token signs in as, and whether GitLab 18.1 or later is met.",
    annotations: { readOnlyHint: true },
  },
  guarded(async () => status(config, gateway, instance)),
);

server.registerTool(
  "fetch_work_item",
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
  "list_work_items",
  {
    title: "List GitLab Work Items",
    description:
      "Lists Issues and Tasks in a project or group (subgroups and projects included) as compact summaries, most recently updated first. 20 by default; ask for more with limit (up to 200) or continue with after.",
    inputSchema: {
      scope: z.string().describe("Full path of the project or group, e.g. acme/app or acme"),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})`),
      after: z.string().optional().describe("Cursor from a previous list, to continue it"),
      ...FILTER_SCHEMA,
    },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ scope, limit, after, parent, ...filters }) => {
    const parentId = parent ? (await reader.resolve(parseReference(parent, config))).id : undefined;
    return listAnswer(`Work Items in ${scope}`, await lists.namespace(scope, { ...filters, parentId }, limit, after));
  }),
);

server.registerTool(
  "my_work_items",
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

await server.connect(new StdioServerTransport());
