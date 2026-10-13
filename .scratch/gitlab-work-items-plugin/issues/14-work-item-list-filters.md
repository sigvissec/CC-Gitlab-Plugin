# How can the plugin Fetch filtered lists of Work Items?

Type: research
Status: resolved
Blocked by: none

## Question

Which GitLab GraphQL fields list Work Items for a project, a group, or across an Instance (for example `project.workItems`, `group.workItems`, `namespace.workItems`), and which filters does each accept for state, Work Item Type, assignee, author, label, milestone, and parent? Which version and tier introduced each field and filter, how does pagination work, and do group-level lists include items from subgroups and projects? How do `glab work-items list` and GitLab's own MCP server (`list_work_items`) map onto these?

## Answer

Findings: [Work Item list filters](https://github.com/sigvissec/CC-Gitlab-Plugin/blob/research/work-item-list-filters/docs/research/work-item-list-filters.md) (branch `research/work-item-list-filters`; from GitLab's and glab's source at pinned refs, not run against a real Instance).

- Four GraphQL fields list Work Items: `project.workItems` (15.1), `group.workItems` (16.3), `namespace.workItems` (18.1, group or project path), and `currentUser.workItems` (17.10, Instance-wide, needs at least one filter, lacks paid-tier filters). There is no top-level `workItems`. From 18.1, `namespace.workItems` covers every scope.
- State, Work Item Type, assignee, author, label include/exclude, and milestone filters exist in every 18.x and 19.x release on Free; parent filtering (`parentIds`) starts in 18.1. Labels and assignees must all match; milestones and types match any.
- "Assigned to me" has no shortcut before 19.2 (`ME` wildcard); on 18.x, look up `currentUser { username }` first.
- Group lists exclude subgroups and projects by default, so on Free a default group list is empty. Always send `includeDescendants: true`.
- Most list fields and every parent argument except `parentIds` are still Experiment.
- Pages are cursor-based, 100 items max (larger requests are capped silently), newest first by default. For full scans, sort by created, updated, or title; some sorts page by position and can skip or repeat items.
- A Work Item's own `children` field only filters by state; for filtered children, list the namespace with `parentIds`.
- `glab work-items list` only filters by type and state and never includes descendants. GitLab's MCP `list_work_items` (19.4+) always includes descendants but can't exclude labels, filter by "me" or parent, and isn't available on Free 18.x.
