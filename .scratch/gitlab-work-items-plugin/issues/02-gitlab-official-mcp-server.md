# What does GitLab's own MCP server offer for Work Items?

Type: research
Status: resolved
Blocked by: none

## Question

GitLab ships an MCP server in recent versions. Which versions and tiers include it, on gitlab.com and on self-managed? Which tools does it expose that touch Work Items (read, Edit, Comment, resolve Threads, create), and what's missing against our Review/Edit/Comment needs? How does a client authenticate to it (OAuth, PAT), and how would a Claude Code plugin connect to it?

## Answer

Findings: [GitLab's official MCP server](https://github.com/sigvissec/CC-Gitlab-Plugin/blob/research/gitlab-official-mcp-server/docs/research/gitlab-official-mcp-server.md) (branch `research/gitlab-official-mcp-server`; read from GitLab's doc sources and code at pinned refs, since docs.gitlab.com is blocked here).

- Built into every Instance at `https://<instance>/api/v4/mcp`. Experiment in 18.3–18.5 (flags), beta in 18.6, GA in 19.5. gitlab.com runs 19.5.
- On 18.x it needs Premium or Ultimate plus GitLab Duo and beta features turned on. It is unavailable on Free self-managed 18.x. Free arrived in 19.2, behind an "Allow connection to GitLab" setting that is on by default from 19.5.
- 18.x tools only read and create project Issues and post or read Comments (`get_issue`, `create_issue`, `create_workitem_note`, `get_workitem_notes`): no Edits, no Tasks or Epics, no Hierarchy or Linked Items.
- 19.x adds `save_work_item` (create and Edit any type, 19.4), `get_work_item` (19.4, Threads with resolved state from 19.5), `list_work_items`, `link_work_items` (add only), `save_note`, `get_work_item_types`.
- Still missing on master: resolving Threads on Work Items, editing or deleting Comments, reading or removing Linked Items, listing children, reading weight.
- Auth is OAuth with dynamic client registration (`mcp` scope). Legacy PATs get 403 on every version; fine-grained PATs with "MCP tool: Execute" work from 19.2. A `glab` login can't be reused (no `mcp` scope).
- Claude Code connects natively over HTTP (`claude mcp add --transport http`, then `/mcp` to authorize); a plugin can ship the same entry in `.mcp.json`.
- `glab mcp serve` is the other first-party option and works on any tier with glab's own login.
