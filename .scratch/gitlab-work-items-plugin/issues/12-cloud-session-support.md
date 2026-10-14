# Must the plugin work in Claude Code on the web, and how does it get there?

Type: grilling
Status: resolved
Blocked by: none

## Question

Cloud sessions don't load plugins from user settings or a repo's `enabledPlugins`; only org managed settings or files committed to a repo reach them (see [What can a Claude Code plugin contain, and how is it configured?](04-claude-code-plugin-format.md)). Is cloud-session support a v1 requirement? If so, which route: org managed settings (Team/Enterprise), a committed `.mcp.json` plus skills per repo, or something else, and how does the token reach a cloud session (environment variables shared by everyone using the environment, or network secrets)?

## Answer

Resolved by grilling (term Desktop added to `/GLOSSARY.md`).

- **No.** Cloud-session support (Claude Code on the web) is not a v1 requirement; it is out of scope for v1.
- **v1 targets Desktop**: Claude Code running on the user's own machine, whether in the Claude desktop app, the `claude` command in a terminal, or the VS Code and JetBrains extensions, provided they share the plugin system (being confirmed against Claude Code's docs).
- If someone runs the plugin in a cloud session anyway (for example by committing it into a repo), there is no special handling and no promise it works; the normal "what's missing" errors still apply, and the docs say v1 targets Desktop only.
- Fact recorded: the user's claude.ai account is not on a Team or Enterprise plan, so organization-wide managed settings aren't available to them.
- Consequences: [How does the plugin talk to GitLab?](10-integration-architecture.md) no longer has to fit cloud sessions; reusing a `glab` login stays fully in play; cloud network secrets and allowlists drop away.
