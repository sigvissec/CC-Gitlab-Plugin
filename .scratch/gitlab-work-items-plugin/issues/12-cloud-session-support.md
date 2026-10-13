# Must the plugin work in Claude Code on the web, and how does it get there?

Type: grilling
Status: open
Blocked by: none

## Question

Cloud sessions don't load plugins from user settings or a repo's `enabledPlugins`; only org managed settings or files committed to a repo reach them (see [What can a Claude Code plugin contain, and how is it configured?](04-claude-code-plugin-format.md)). Is cloud-session support a v1 requirement? If so, which route: org managed settings (Team/Enterprise), a committed `.mcp.json` plus skills per repo, or something else, and how does the token reach a cloud session (environment variables shared by everyone using the environment, or network secrets)?
