# What can a Claude Code plugin contain, and how is it configured?

Type: research
Status: resolved
Blocked by: none

## Question

Per Claude Code's official plugin documentation: what components can a plugin bundle (skills, slash commands, agents, hooks, MCP servers, anything else), how is each declared (plugin.json and directory layout), how does a plugin-bundled MCP server get launched (bundled binary, npx, uvx, remote URL), and how does a user supply per-install config and secrets such as an Instance host and a token (userConfig, env var expansion, keychain)? How are plugins distributed and updated through marketplaces, and how do plugin components appear in cloud sessions?

## Answer

Findings: [Claude Code plugin format](https://github.com/sigvissec/CC-Gitlab-Plugin/blob/research/claude-code-plugin-format/docs/research/claude-code-plugin-format.md) (branch `research/claude-code-plugin-format`; docs fetched 2026-10-13, behaviour checked with Claude Code CLI 2.1.296).

- A plugin is a directory with `.claude-plugin/plugin.json` (only `name` required) bundling skills, commands, agents, hooks, MCP and LSP servers, output styles, `bin/` executables, and more. Everything is namespaced by plugin name (`/gitlab-work-items:<skill>`, `mcp__plugin_gitlab-work-items_<server>__<tool>`).
- A bundled MCP server is declared in `.mcp.json` or the manifest: a script via `${CLAUDE_PLUGIN_ROOT}`, a binary, `npx`/`uvx`, a `.mcpb` bundle, or a remote HTTP/SSE/WebSocket URL (remote HTTP gets OAuth). It starts automatically while the plugin is enabled.
- Instance host and token fit `userConfig`, with the token `sensitive` (Keychain or `~/.claude/.credentials.json`), passed to the server as `${user_config.KEY}`. Env-var expansion also works and local servers inherit the user's environment, so a "configured token, then `GITLAB_TOKEN`, then glab" chain can live in the server. An unset sensitive value arrives as an empty string.
- Slash commands are skills; `disable-model-invocation: true` makes one user-only. Skills can run shell commands; `allowed-tools` pre-approves for that turn only.
- Distribution is a git repo with `.claude-plugin/marketplace.json`, which can be hosted on GitLab. A pinned `version` holds users on it; third-party auto-update is off by default.
- Cloud sessions (Claude Code on the web) don't load plugins from user settings or a repo's `enabledPlugins`/`extraKnownMarketplaces`. Only org managed settings or files committed to the repo (skills, `.mcp.json`, hooks) reach them. A self-managed Instance needs a network allowlist entry there.
- Anthropic's official marketplace already has a `gitlab` plugin: just a remote MCP pointer to `https://gitlab.com/api/v4/mcp` with OAuth, with no skills, no `userConfig`, and no self-managed support.
- Unverified: whether any route loads a plugin in a real cloud session; whether plugin MCP tools prompt on first use; whether GitLab accepts a PAT as `Authorization: Bearer` (belongs to the API research ticket).
