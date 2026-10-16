# What can GitLab's Work Items API do, and where is it gated?

Type: research
Status: resolved
Blocked by: none

## Question

Which GitLab API surfaces (GraphQL and any REST) let a client read a Work Item (description, fields, Threads, Hierarchy, Linked Items), Edit each field in the Edit definition, post Comments and replies, resolve Threads, and create Issues, Tasks, and Epics? For each capability: the query or mutation, the GitLab version it arrived in, the tier it needs, how a Work Item is identified (global ID vs. IID vs. URL), and the PAT scopes required. Call out differences between gitlab.com and self-managed, and what Free tier can and cannot do (especially Epics).

## Answer

Findings: [GitLab Work Items API](https://github.com/sigvissec/CC-Gitlab-Plugin/blob/research/gitlab-work-items-api/docs/research/gitlab-work-items-api.md) (branch `research/gitlab-work-items-api`; read from GitLab's doc sources and code at `v18.0.0-ee`, `v18.11.0-ee`, and master, since docs.gitlab.com is blocked here).

- The GraphQL Work Items API (`/api/graphql`) is the only surface covering Issues, Tasks, and Epics alike: reads, every Edit field, Hierarchy, Linked Items, Comments, replies, Thread resolution (`discussionToggleResolve`), and creation. All needed inputs exist in 18.0.
- The whole API is still labelled Experiment in every 18.x release and on master, so it can change without notice.
- Writes need a global ID (`gid://gitlab/WorkItem/N`). Resolve URLs and IIDs with `namespace(fullPath).workItem(iid)` or `workItemsByReference` (at most 10 refs). Look up type IDs per namespace instead of hard-coding them.
- Scopes: `read_api` for Review; `api` for any write. Fine-grained tokens are documented for REST only.
- Free covers Issues and Tasks fully except weight, multiple assignees, and blocking links. Epics need Premium; Epics inside Epics need Ultimate.
- Use the Work Items API for Epics; the legacy Epic APIs are deprecated, use different IDs, and can't resolve Threads.
- The legacy REST Issues API still works on Issues and Tasks as a fallback, but can't set a Task's parent or reach Epics. The new REST Work Items API is off by default and has no update.
- gitlab.com and self-managed share the API; they differ in licensing basis, version (gitlab.com runs 19.x), flag control, CE vs EE schemas, and sub-path base URLs.
- Gotchas: `createNote` makes an unresolvable Comment (use `createDiscussion` for a Thread); an unlicensed widget input fails the whole mutation; some Edits are dropped silently, so re-read after writing; there is no optimistic locking.
- Check `userPermissions` on the Work Item and Thread instead of hard-coding roles; GitLab's own docs disagree on who can resolve Threads.
