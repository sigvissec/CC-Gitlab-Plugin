// The gitlab-work-items MCP server: Claude's bridge to GitLab Work Items, through glab.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { Instance } from "./instance.js";
import { guarded } from "./result.js";
import { status } from "./tools/status.js";

const config = readConfig();
const gateway = new Gateway(config);
const instance = new Instance(gateway);

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

await server.connect(new StdioServerTransport());
