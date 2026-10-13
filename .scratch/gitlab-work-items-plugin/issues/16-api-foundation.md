# Which GitLab API does the plugin build on?

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 14

## Question

GitLab's GraphQL Work Items API is the only surface covering everything the destination needs, but it is labelled Experiment. Does the plugin build on it, with or without the stable REST Issues API as a fallback? And do GitLab's own MCP server and glab's MCP server stay in the running as the plugin's foundation?

## Answer

- **GraphQL only, no REST fallback.** The plugin builds on GitLab's GraphQL Work Items API despite its Experiment label: it is the only API covering Tasks under Issues, Epics, Thread resolution, and parent filters, and a REST fallback would mean two code paths that still can't set a Task's parent or reach Epics.
- **Softening the Experiment risk:** the plugin reads the Instance's version first, re-reads each Work Item after writing it (to catch silent drops), and reports GitLab's errors as they are instead of guessing.
- **GitLab's own MCP server is ruled out:** it rejects classic PATs and `glab` logins (contradicting the destination's auth), needs Premium on 18.x, can't resolve Threads, and lacks the list filters.
- **glab's MCP server (`glab mcp serve`) is ruled out:** it is experimental, exposes 217 tools that would crowd Claude's context, can hand the stored token to Claude, and lacks the list filters.
- This leaves two candidates for [How does the plugin talk to GitLab?](10-integration-architecture.md): a custom MCP server calling GraphQL, or skills calling `glab api graphql`.
