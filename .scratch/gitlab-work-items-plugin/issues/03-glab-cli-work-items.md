# What can the glab CLI do with Work Items, and can a plugin reuse its login?

Type: research
Status: resolved
Blocked by: none

## Question

What does the `glab` CLI support for Issues, Tasks, Epics, Comments, and Threads natively, and what needs `glab api` (REST or GraphQL) instead? How does glab store credentials and per-Instance hosts, and how can another program (a skill's shell command or an MCP server) reuse an existing `glab auth login` token safely, for both gitlab.com and self-managed?

## Answer

Findings: [glab CLI and Work Items](https://github.com/sigvissec/CC-Gitlab-Plugin/blob/research/glab-cli-work-items/docs/research/glab-cli-work-items.md) (branch `research/glab-cli-work-items`, checked against glab v1.123.0; not tested against a real Instance).

- Native `glab work-items` (experimental) has list/create/update/delete only: no view, Comments, Threads, Hierarchy, or Linked Items; `update` can't set labels, state, or parent; `create` can't set a parent and hard-codes type IDs; `delete` doesn't confirm.
- `glab issue` (REST, project-only) covers view/create/update/close and top-level Comments, but not Thread replies or resolution, Tasks, or Epics.
- So most plugin actions go through `glab api graphql`, which handles typed variables, JSON inputs, and single-connection pagination; mutation-level errors still exit 0 and must be checked in the payload.
- Login reuse is practical: shell out to `glab api --hostname <instance>` so the plugin never holds the token. Tokens live in the OS keyring by default (since v1.111.0), with per-Instance config entries.
- `GITLAB_TOKEN` (and friends) override stored tokens for every host, so one Instance's token can be sent to another.
- glab ships an experimental stdio MCP server (`glab mcp serve`, 217 tools) whose auth-status tool can return the stored token to the model.
- Under the Claude Code sandbox, glab can't persist refreshed OAuth tokens unless glab is excluded or its config dir is writable.
