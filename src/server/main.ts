// The gitlab-work-items MCP server: Claude's bridge to GitLab Work Items, through glab.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { Instance } from "./instance.js";
import { Reader } from "./reader.js";
import { guarded } from "./result.js";
import { status } from "./tools/status.js";
import { fetchWorkItem } from "./tools/fetch.js";
import { z } from "zod";

const config = readConfig();
const gateway = new Gateway(config);
const instance = new Instance(gateway);
const reader = new Reader(config, gateway, instance);

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

await server.connect(new StdioServerTransport());
