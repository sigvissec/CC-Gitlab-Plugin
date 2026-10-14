# How does the plugin talk to GitLab?

Type: grilling
Status: open
Blocked by: 01, 02, 03, 04, 05, 12, 13, 14, 16

## Question

Choose the integration architecture between the two candidates left by [Which GitLab API does the plugin build on?](16-api-foundation.md): (a) a custom MCP server bundled in the plugin that calls GitLab's GraphQL Work Items API, or (b) skills that call `glab api graphql`, or a combination. GitLab's own MCP server and glab's MCP server are ruled out. The choice fixes the implementation language, how auth works for PAT and glab, and how the plugin is packaged, and must fit the answer to [Must the plugin work in Claude Code on the web, and how does it get there?](12-cloud-session-support.md). It must also let only the user confirm a Write, so Claude's own word can't count as a yes (see [What safety rails guard writes to GitLab?](08-write-safety.md)).
