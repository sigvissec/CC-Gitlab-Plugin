# How does the plugin talk to GitLab?

Type: grilling
Status: open
Blocked by: 01, 02, 03, 04, 05

## Question

Choose the integration architecture: (a) a custom MCP server bundled in the plugin that calls GitLab's API, (b) skills that shell out to `glab` and `glab api graphql`, or (c) GitLab's own MCP server with plugin skills and commands on top, (d) glab's built-in MCP server (`glab mcp serve`), or a combination. The choice fixes the implementation language, how auth works for PAT and glab, and how the plugin is packaged.
