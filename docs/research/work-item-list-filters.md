# How can the plugin Fetch filtered lists of Work Items?

Research for ticket `14-work-item-list-filters` (GitLab Work Items plugin map). Researched 2026-10-13.

Terms follow `/GLOSSARY.md`. GraphQL identifiers keep GitLab's spelling, for example `types: [ISSUE, TASK, EPIC]`.

**What was read.**

- **GitLab source and docs** (`gitlab-org/gitlab`). Source was read at three pinned refs through blobless sparse clones:
  - `v18.0.0-ee` (tag `6734ea03`, commit `504fd9e5`): the 18.x baseline.
  - `v18.11.0-ee` (tag `8be8c00d`, commit `1060c7b0`): the last 18.x minor.
  - `master` at `099d3396` (`VERSION` = `19.5.0-pre`): what gitlab.com runs. Its GraphQL reference is byte-identical to the one at master `0f292a09`, the newest commit on 2026-10-13.
  - The MCP tool was also read at `v19.4.0-ee` (commit `fa703f93`).
- **The GraphQL reference** (`doc/api/graphql/reference/_index.md`, or `index.md` before 17.9) at every `vX.Y.0-ee` tag from 17.0 to 19.4, plus 16.0. "Since" values come from diffing each field's argument table across those tags. They name the first `.0` release whose reference lists the argument. Where the reference prints an "Introduced in" badge, that badge is quoted instead.
- **glab** (`gitlab-org/cli`) at tag `v1.123.0` (commit `5686d748`).

docs.gitlab.com is blocked by this environment's egress policy, so doc pages were read from `doc/` in the repo. Nothing was run against a live Instance.

Citation keys in brackets point to the Sources list. `Lnn` is a line in that source at its pinned ref.

## Answer

- **Four GraphQL fields list Work Items. There is no top-level `Query.workItems`** [C1, G1]:
  - `project(fullPath).workItems` (15.1): one project.
  - `group(fullPath).workItems` (16.3): one group, optionally with its subgroups and projects.
  - `namespace(fullPath).workItems` (18.1): the same resolver as `group.workItems`. It accepts a group path or a project path and returns `null` for user namespaces.
  - `currentUser.workItems` (17.10): everything the user can see across the Instance. It refuses to run without at least one filter.

  All four take the same core filters from one shared module [C6]. On 18.1 and later the plugin can use `namespace.workItems` for every scope. It needs `project`/`group.workItems` only to support 18.0.
- **Every filter the plugin asked about exists on every 18.x and 19.x release and works on Free, except parent filtering, which starts in 18.1.** The filters are state, Work Item Type, assignee, author, label include and exclude, milestone, and parent [C6, G2, G3].
  - Label exclusion and "any of" go through the `not: {…}` and `or: {…}` input objects, both in the schema since 17.2 [C7].
  - Plain list arguments are AND for labels and assignees, and OR for milestones and types [C10].
- **"Assigned to me" has no shortcut on 18.x.** The `ME` assignee wildcard was added in 19.2 (commit `94dd58fc`) [C8, G4]. On 18.x, read `currentUser { username }` first and pass `assigneeUsernames: [<username>]`. No author wildcard exists on any version.
- **Group lists do not include subgroups or projects by default.** `includeDescendants` defaults to `false` [C4 L23-26]. With the default, a group list returns only that group's own group-level items, which means its Epics. Epics need Premium. So on Free (18.1 and later) the default group list is **empty**, and on 18.0 Free `group.workItems` returns `null` [C4, C9].
  - Pass `includeDescendants: true` to add subgroups and all descendant projects.
  - `excludeProjects` (17.5) or `excludeGroupWorkItems` (18.4) narrow the list to Epics only or project items only.
  - Items in archived projects are left out unless `includeArchived: true` (18.5) is passed [C4 L41-45, L64].
- **Most of this is still Experiment.** The `project`, `namespace`, and `currentUser` list fields are Experiment on master. `group.workItems` lost its Experiment label in 19.0 [C2, G1].
  - All parent and hierarchy arguments except plain `parentIds` are Experiment: `hierarchyFilters`, `includeDescendantWorkItems`, `not.parentIds`, and `parentWildcardId`. So are `excludeProjects`, `excludeGroupWorkItems`, and `includeArchived` [G2].
  - None of the asked-for filters is behind a feature flag on 18.1 or later. The only flag gate is on 18.0's `group.workItems` (`namespace_level_work_items`, or `work_item_epics` plus the `epics` license) [C4].
- **Pagination is Relay cursors.**
  - Arguments are `first`/`after` or `last`/`before`. The page holds 100 nodes when `first` is omitted, and 100 is also the maximum; a larger `first` is silently capped [C11].
  - Default sort is `CREATED_DESC` [C3 L14-18].
  - Since 18.1, the sorts `PRIORITY_*`, `POPULARITY_*`, `LABEL_PRIORITY_*`, `MILESTONE_DUE_*`, `ESCALATION_STATUS_*`, and `STATUS_*` switch to offset-based cursors, which can skip or repeat items when data changes mid-scan [C3 L38-45, C11].
  - Use `CREATED_*`, `UPDATED_*`, or `TITLE_*` for stable scans.
- **Children with filters: use `parentIds` (18.1+), not the Hierarchy widget.** `workItem.widgets { … on WorkItemWidgetHierarchy { children(state:) } }` accepts only `state` [G1, C12].
  - For filtered children, list the namespace where the children live with `parentIds: [<parent GID>]` plus any other filter. For an Epic's children that is the group with `includeDescendants: true`.
  - `includeDescendantWorkItems: true` (18.3, Experiment) returns the whole subtree [C9 L79-93].
- **`glab work-items list` (v1.123.0) covers almost none of this.** It sends `project`/`group.workItems(types, state, first, after)` and nothing else [L1, L2].
  - It never passes `includeDescendants`, so `--group` lists only the group's own Epics.
  - It has no assignee, author, label, milestone, parent, or sort flag.
  - `glab api graphql --paginate` can send any of the queries in this note [P2].
- **GitLab's MCP `list_work_items` (19.4+) covers the basic filters only.** It always queries `namespace.workItems` with `includeDescendants: true` [M2, M3]. It exposes state, search, author, assignees (AND), labels (AND), milestone and its wildcard, types, created, updated, and due ranges, a reduced sort list, and `first` (at most 100, default 20) with `after`.
  - It has no label exclusion, no OR, no "me", no parent filter, and no way to turn off descendants.
  - It needs 19.2+ for Free and an OAuth `mcp` token [P3], so it is not an 18.x path.

## Filter-by-field table

**List fields**

| Field | Scope | Since | Status | Tier | Notes |
|---|---|---|---|---|---|
| `project(fullPath:).workItems` | One project | 15.1 | Experiment in every release through master [G1 L61822-61829, G3 L37352-37359] | Free | Resolver `Resolvers::WorkItemsResolver` [C1, C3]. The only project-scoped list on 18.0. |
| `group(fullPath:).workItems` | One group; with `includeDescendants` its subgroups and projects too | 16.3 | Experiment through 18.11 [G2 L39401-39406]; **label removed in 19.0** [C2, G4 v19.0 L40773] | Free field. Group-level items (Epics) need Premium [C9]. | Same resolver as `Namespace.workItems` [C1]. On **18.0** the resolver returns `null` unless the group has namespace-level Work Items enabled [C4 18.0 L25-29]. |
| `namespace(fullPath:).workItems` | A group path behaves like `group.workItems`; a project path like `project.workItems`; a user namespace returns `null` | 18.1 [G2 L44371-44378] | Experiment [G1 L56041-56048] | Free | Group-only arguments are dropped for project paths [C4 L9-16, L68]. |
| `currentUser.workItems` | Every project the user can see on the Instance | 17.10 | Experiment [G1 L42823-42830] | Free | Raises "You must provide at least one filter argument" if called without one [C5 L24-31]. It has only the CE filter set, with no EE filters such as weight or status [G1 L42844-42878]. It never sets a group, so group-level Epics are not returned (inferred from [C9]). |
| `workItem…WorkItemWidgetHierarchy.children` | Direct children of one item | before 18.0 | not marked | Free | Only argument is `state: OPEN \| CLOSED` [G1 L68707-68721, C12]. |
| `Query.workItems` | does not exist | none | none | none | Not in `query_type.rb` at 18.0, 18.11, or master [C1]. The legacy `Query.issues` (15.6, Experiment) returns `Issue` objects, not Work Items [G2 L1396-1403]. |

**Filters.** Unless a row says otherwise, the argument is on all four list fields. On `namespace.workItems` it exists from 18.1 and on `currentUser.workItems` from 17.10. The reference first lists the core filters (assignee, author, label, milestone, `not`, `or`) on `project`/`group.workItems` at 17.2. `state` and `types` are there at 16.0. Every one of them is present in the 18.0 baseline [G3, G4].

| Need | GraphQL argument | Semantics (source) | Since | Status | Tier |
|---|---|---|---|---|---|
| State | `state: IssuableState` (`opened`, `closed`, `all`) | Omitted means all states. `locked` raises an error [C6 L53-61]. | ≤16.0 (`project`) | stable | Free |
| Work Item Type | `types: [IssueType!]` (`ISSUE`, `TASK`, `EPIC`, …) | Any of the given types [C10] | ≤16.0 (`project`) | stable. The `EPIC` value is marked Experiment (16.7) [G2] | Free. `EPIC` needs Premium. |
| | `workItemTypeIds: [WorkItemsTypeID!]` | Mutually exclusive with `types` [C6 L67-72, L155] | 18.10 | stable | Free |
| | `not: { types }`, `not: { workItemTypeIds }` | Excludes those types [C7] | 17.2 / 18.10 | stable | Free |
| Assignee | `assigneeUsernames: [String!]` (max 100) | **AND**: the item must be assigned to every listed user [C10 assignee L59-77] | 17.2 | stable | Free (filtering works on Free; several assignees per item need Premium [P1]) |
| | `assigneeWildcardId: NONE \| ANY` | Mutually exclusive with `assigneeUsernames` [C6 L156] | 17.2 | stable | Free |
| | `assigneeWildcardId: ME` | Logged-in user is assigned [C8, C10 assignee L27-28] | **19.2** [G4 v19.2 L63892; absent at v19.1 L59729] | stable | Free |
| | `or: { assigneeUsernames }` | Any of the listed users [C7, C10 L35-39] | 17.2 | stable | Free |
| | `not: { assigneeUsernames }` | Assigned to none of the listed users [C7, C10 L41-45] | 17.2 | stable | Free |
| Author | `authorUsername: String` | One user. No `ME` wildcard exists [C6 L17-20] | 17.2 | stable | Free |
| | `or: { authorUsernames }`, `not: { authorUsername: [..] }` | Any of the listed users / none of them [C7] | 17.2 | stable | Free |
| Label (include) | `labelName: [String!]` (max 100) | **AND**: every label must be present. `None` and `Any` are special values. An unknown label name returns an **empty list**, not an error [C10 label L37-47, L78-96] | 17.2 | stable | Free (scoped labels are Premium [P1]) |
| | `or: { labelNames }` | Any of the labels [C10 label L51-61] | 17.2 | stable | Free |
| Label (exclude) | `not: { labelName: [..] }` | The item has none of the labels [C10 label L63-67] | 17.2 | stable | Free |
| Milestone | `milestoneTitle: [String!]` | **Any of** the titles (`WHERE title IN`) [C10 milestoneable L24] | 17.2 | stable | Free |
| | `milestoneWildcardId: NONE \| ANY \| STARTED \| UPCOMING` | Mutually exclusive with `milestoneTitle` [C6 L157] | 17.2 | stable | Free |
| | `not: { milestoneTitle, milestoneWildcardId }` | Excludes those titles, or `STARTED`/`UPCOMING` | 17.2 | stable | Free |
| Parent | `parentIds: [WorkItemID!]` (max 100) | Direct children of the listed parents [C9 L79-93] | **18.1** [G4; v18.1 source L101-104] | stable (no badge) | Free for Task under Issue. Epic parents need Premium [P1]. |
| | `includeDescendantWorkItems: Boolean` | With `parentIds`, the whole subtree (children, grandchildren, and so on) [C9 L84-90] | 18.3 | **Experiment** | as above |
| | `parentWildcardId: NONE \| ANY` | Items with no parent / with any parent [C9 L102-113] | 18.5 | **Experiment** | as above |
| | `hierarchyFilters: { parentIds, includeDescendantWorkItems, parentWildcardId }` | The same three filters in one input. Mutually exclusive with the top-level forms [C6 L119-122, L160-163; C7] | 18.3 | **Experiment** | as above |
| | `not: { parentIds }` | Items not under the listed parents [C7 negated L34-40, C9 L95-100] | 18.3 | **Experiment** | as above |
| Group scope | `includeDescendants` (default `false`), `includeAncestors` | See "Group scope" below [C4 L18-26] | 16.3 field; ≤17.0 in the reference | stable | Free. Group-level items need Premium. |
| | `excludeProjects` | Drops project items, which leaves only group-level items [C4 L28-32] | 17.5 | **Experiment** | Premium in effect (Epics only) |
| | `excludeGroupWorkItems` | Drops group-level items [C4 L34-39] | 18.4 | **Experiment** | Free |
| | `includeArchived` (default `false`) | Adds items from archived projects [C4 L41-45, L64] | 18.5 | **Experiment** | Free |
| Free text | `search`, `in: [TITLE, DESCRIPTION]` | Title and description by default | ≤16.0 | stable | Free |
| Sort | `sort: WorkItemSort` | Default `CREATED_DESC` [C3 L14-18]. Several values are Experiment (17.9-18.3) [G2 L60654ff] | ≤16.0 | mixed | Free. `WEIGHT_*`, `HEALTH_STATUS_*`, and `STATUS_*` sort on EE fields. |
| Other | `iid`/`iids`, `ids` (18.6), `confidential`, `created/updated/closed/dueAfter/Before` (17.9), `subscribed` (17.7), `myReactionEmoji` | [C6] | as noted | stable | Free |
| EE only | `weight`, `weightWildcardId`, `iterationId`, `iterationWildcardId`, `iterationCadenceId`, `healthStatusFilter`, `status` (18.0, Experiment), `customField` (17.10, Experiment), `verificationStatusWidget` | Missing from the CE schema [C14]. Not on `currentUser.workItems` | as noted | as noted | Licensed. Tiers for weight, iteration, and status are Premium and for health status Ultimate, per [P1]. Custom fields were not checked. |

## Detail

### Choosing a field per version

- **18.1 and later (all of 18.x except 18.0, plus 19.x, which includes gitlab.com):** use `namespace(fullPath: $path) { workItems(…) }` for both projects and groups. It is one query shape. Group-only arguments are silently dropped when the path is a project [C4 L61-72].
- **18.0:** use `project(fullPath:).workItems` for projects and `group(fullPath:).workItems` for groups. 18.0 lacks `parentIds`, `ids`, `workItemTypeIds`, `hierarchyFilters`, and the wildcard parents [G3; C6 18.0 L8-103]. On 18.0 the group field also needs namespace-level Work Items: the development flag `namespace_level_work_items` (off by default), or the `work_item_epics` flag (beta, on by default) together with the `epics` license [C4 18.0]. On 18.0 Free, a group list therefore returns `null`. The plugin can still list a group's projects one at a time.
- **Across the Instance** ("all my open Tasks"): `currentUser { workItems(assigneeUsernames: [$me], state: opened, types: [TASK]) }`.
  - At least one filter is mandatory [C5].
  - It searches every project the user can see, public projects included, through the same `WorkItemsFinder` with no project or group set [C5 L33-35, C9].
  - Always pair it with a user-scoped filter such as assignee or author. Its cost on gitlab.com was not measured.
- **Experiment status.** GitLab's policy lets Experiment fields change or disappear without notice [P1, S2 L285-292 there].
  - Commit `e16c24ab` ("Promote work items from experiment", 2026-04-23, in v19.0.0-ee) removed the Experiment label only from `Group.workItems`, `Group.workItem`, and `Group.workItemStateCounts` [C2].
  - `Project.workItems`, `Namespace.workItems`, and `CurrentUser.workItems` are still Experiment on master [G1].

### Group scope: subgroups and projects

The group and namespace resolver passes `group_id` with `include_descendants`, `include_ancestors`, `exclude_projects`, `exclude_group_work_items`, and `non_archived` to `WorkItems::WorkItemsFinder` [C4 L61-72]. What comes back depends on whether the group "supports work items". That is true only when the EE type provider adds the Epic type, which happens only with the `epics` license, meaning Premium or Ultimate [C9 namespace.rb L955-957, provider L26-33, L251-261].

| Arguments | Premium / Ultimate group | Free group, or CE |
|---|---|---|
| default (`includeDescendants: false`) | Only group-level items of that exact group, meaning its Epics [C9 EE L38-53, L82-92] | **Empty** on 18.1+: "group-level work items are not supported in CE" [C9 L115-117]. **`null`** on 18.0 [C4 18.0]. |
| `includeDescendants: true` | Group-level items of the group and all subgroups, plus project items (Issues, Tasks) in every descendant project the user can see | Project items in every descendant project |
| `+ excludeProjects: true` | Epics only, across the hierarchy | Empty |
| `+ excludeGroupWorkItems: true` (18.4+) | Project items only | Project items only |
| `includeAncestors: true` | Also group-level items of ancestor groups | No effect on project items |
| `includeArchived: true` (18.5+) | Also items from archived projects. Without it they are excluded (`non_archived = !include_archived`) [C4 L64] | same |

So the plugin should always send `includeDescendants: true` when the user means "everything in group X", and add `excludeProjects` or `types: [EPIC]` when it means Epics only.

### Filter semantics worth knowing

- **AND versus OR.** `labelName` and `assigneeUsernames` require all listed values [C10]. `milestoneTitle` and `types` match any of the listed values. Use `or: { labelNames | assigneeUsernames | authorUsernames }` for "any of". `or` supports only those three keys, plus `customField` from 18.4 [G2 L65503ff].
- **Exclusion.** `not` accepts:
  - since 17.2: `assigneeUsernames`, `authorUsername`, `labelName`, `milestoneTitle`, `milestoneWildcardId`, `myReactionEmoji`, and `types`;
  - later additions: `releaseTag` (18.1), `parentIds` (18.3, Experiment), and `workItemTypeIds` (18.10);
  - EE keys (`healthStatusFilter`, `iterationId`, `weight`, and `customField`).

  [C7, G1 L81225ff, G4]
- **Silent empties.** A misspelled label returns an empty list rather than an error [C10 label L82]. On Free, a group list without `includeDescendants` is also empty [C9]. The plugin should not report "no items" without checking for these two cases.
- **Limits.** List arguments are capped at 100 values each, enforced by `validates: { length: { maximum: 100 } }` from 18.11 at the latest [C6 L8-52]. In 18.1 the cap was checked only for `parentIds` and `releaseTag` [v18.1 source L124-131].
- **Elasticsearch routing.** If Advanced Search is on, list queries whose GraphQL `operationName` starts with `GLQL`, or equals the UI's `getWorkItemsFullEE`/`getWorkItemsSlimEE`, are served from Elasticsearch [C13]. Other names use PostgreSQL. The plugin should pick its own operation names so that behavior stays predictable.

### Pagination and sorting

- **Cursors.** Every list is a Relay connection: `first`/`after` forward, `last`/`before` backward. Read `pageInfo { hasNextPage endCursor }` [G2 L17674-17691].
- **Page size.**
  - The schema's `default_max_page_size` is 100 on 18.0, 18.11, and master [C11].
  - With no `first`, GitLab returns 100 records [C11 getting_started L405-409].
  - Requesting more than the maximum "returns only the maximum number of records" [C11 _index L356-361].
  - No Work Item list field overrides the maximum.
- **Complexity.** The authenticated query complexity limit is 250 [C11]. On master, a list's complexity multiplier is 0.01 per requested item, or 0.05 when `iids` is passed, so `first: 100` roughly doubles the cost of the node selection [C11 base_resolver L134-153, base_field L184-192]. That was not checked on 18.x.
- **Counts.** `WorkItemConnection.count` returns the exact total. From 18.10 it takes a `limit` argument and returns limit + 1 when there are more [G1 L33852-33862, G4].
- **Sort values.**
  - `CREATED_*`, `UPDATED_*`, `TITLE_*`, `DUE_DATE_*`, `START_DATE_*`, `CLOSED_AT_*`, `MILESTONE_DUE_*`, `LABEL_PRIORITY_*`, `PRIORITY_*`, `POPULARITY_*`, `RELATIVE_POSITION_ASC`, `SEVERITY_*`, `ESCALATION_STATUS_*`, `BLOCKING_ISSUES_*` (18.1), and `STATUS_*` (18.3).
  - EE adds `WEIGHT_*` and `HEALTH_STATUS_*`.
  - Many values carry Experiment badges dated 17.9 to 18.3 [G2 L60654ff].
- **Unstable cursors.** From 18.1, the project, group, and namespace resolvers switch to offset pagination for `PRIORITY`, `POPULARITY`, `LABEL_PRIORITY`, `MILESTONE_DUE`, `ESCALATION_STATUS`, and `STATUS` sorts [C3 L38-45, C11 non_stable L5-17]. The fix was commit `ef59981d` (2025-05-20); the file is absent at v18.0.0-ee. `currentUser.workItems` has no such fallback [C5].

### Children of a Work Item

| Approach | Filters | Versions | Notes |
|---|---|---|---|
| `workItem(id:) { widgets { … on WorkItemWidgetHierarchy { children(state: OPEN, first: 100) { nodes { … } pageInfo { … } } } } }` | `state` only | all | Direct children only. Field complexity is 5 [C12]. Use it for Review and filter on the client. |
| `namespace(fullPath: <project>) { workItems(parentIds: [<Issue GID>], …) }` | every list filter | 18.1+ | Tasks of an Issue: Tasks live in the Issue's project. |
| `namespace(fullPath: <group>) { workItems(includeDescendants: true, parentIds: [<Epic GID>], …) }` | every list filter | 18.1+ | Children of an Epic: child Issues sit in projects and child Epics in subgroups. Children outside that group's hierarchy are not returned (inferred from the finder scoping [C9]). |
| add `includeDescendantWorkItems: true` | | 18.3+ (Experiment) | Whole subtree [C9 L84-90] |
| `parentWildcardId: NONE` | | 18.5+ (Experiment) | Items with no parent, for example Issues not under any Epic [C9 L102-113] |

GitLab's MCP server has no children listing at all; prior research found it returns only `hasChildren` [P3].

### `glab work-items list` (v1.123.0)

The command sends one of two hard-coded queries, `group(fullPath:).workItems(types:, state:, first:, after:)` or `project(fullPath:).workItems(…)`. Each node carries only `iid`, `title`, `state`, `workItemType.name`, `author.username`, and `webUrl` [L2 L39-87]. The command is marked EXPERIMENTAL [L3 L13-25].

| GraphQL filter | glab flag | Notes |
|---|---|---|
| scope | `-g/--group <path>` (group) or `-R`/current repo (project) | Mutually exclusive. Repo context is used when `--group` is absent [L4 L12-34]. **No `includeDescendants`**, so `--group` returns only that group's Epics on Premium and nothing on Free (18.1+) [C9]. |
| `state` | `--state opened\|closed\|all` (default `opened`) | `all` omits the argument [L1 L115, L2 L130-133] |
| `types` | `-t/--type` (repeatable or comma-separated) | Uppercased and sent as `IssueType`. Only empty strings are rejected client-side [L2 L106-113] |
| `first` / `after` | `-P/--per-page` (1-100, default 20) / `--after <cursor>` | JSON output includes `pagination.next_cursor` [L1 L38-49, L117, L136-140] |
| assignee, author, label (include/exclude), milestone, parent, search, sort, `includeDescendants` | **none** | Not exposed [L1 L112-117, L3 L65-76] |

For everything else, use `glab api graphql -F query=@q.graphql -f fullPath=… --paginate`.

- `-F` with an `@` prefix reads the value from a file [L5 L62-63].
- The query must declare `$endCursor: String` and select `pageInfo { hasNextPage endCursor }` [L5 L124-128].
- `--paginate` follows only the first connection in the response and prints one JSON document per page [P2].

### GitLab MCP server `list_work_items` (19.4+)

The tool composes a `namespace(fullPath:).workItems` query (operation `GetWorkItemsCompact`). It always sets `includeDescendants: true`, `excludeProjects: false`, and `excludeGroupWorkItems: false` [M3 L100-140, L176-181]. Rows carry only `id`, `iid`, `title`, `state`, `webUrl`, `reference(full: true)`, `createdAt`, `updatedAt`, and `workItemType` [M3 L193-207]. The tool's input schema and filter mapping are identical at v19.4.0-ee and master [M1, M2].

| GraphQL filter | `list_work_items` parameter | Notes |
|---|---|---|
| scope | exactly one of `url`, `project_id`, `group_id` [M2 L62-67] | Group scope always includes descendants, and that cannot be changed [M1 L17-23] |
| `state` | `state: opened\|closed\|all` | Default all [M1 L39-43] |
| `types` | `types: [...]` (any `IssueType` value) | [M1 L11, L75-79] |
| `assigneeUsernames` | `assignee_usernames` (AND, max 100) | **No `assigneeWildcardId`**, so there is no `ME`, `NONE`, or `ANY` [M2 L41-58] |
| `authorUsername` | `author_username` | |
| `labelName` | `label_name` (AND, max 100) | **No `not` and no `or`**, so labels cannot be excluded [M2 L41-58] |
| `milestoneTitle`, `milestoneWildcardId` | `milestone_title`, `milestone_wildcard_id` | |
| `search` | `search` | |
| created/updated/due ranges | `created_after` … `due_before` | No closed-date range |
| `parentIds` / `hierarchyFilters` | **none** | The query builder declares `hierarchyFilters`, `not`, `or`, and `assigneeWildcardId`, but `agent_filters` never fills them [M3 L15-46, M2 L41-58] |
| `sort` | `sort` | Only `DEFAULT_SORTING_KEYS`: no `DUE_DATE_*`, `START_DATE_*`, `MILESTONE_DUE_*`, `LABEL_PRIORITY_*`, `WEIGHT_*`, or `STATUS_*` [M1 L7-10, sorting_keys L5] |
| `first` / `after` | `first` (1-100, default 20), `after` | No backward paging [M3 L181, M4 L7-9] |
| EE `healthStatusFilter`, `status` | `health_status_filter` (`onTrack`, `needsAttention`, `atRisk`), `status: {name}` | The tools doc marks both "Ultimate only" [M5, M6 L1812-1813]. Prior research found the Status widget is Premium [P1], so the doc and the license list disagree. |

### Query shapes for the spec

```graphql
# 18.1+: one shape for projects and groups.
query PluginListWorkItems($fullPath: ID!, $endCursor: String) {  # $endCursor: the name glab --paginate needs
  namespace(fullPath: $fullPath) {
    workItems(
      includeDescendants: true          # ignored for project paths
      state: opened
      types: [ISSUE, TASK]
      assigneeUsernames: ["alice"]      # 19.2+: assigneeWildcardId: ME
      labelName: ["bug"]                # AND
      not: { labelName: ["wontfix"] }   # exclude
      milestoneTitle: ["19.6"]
      sort: UPDATED_DESC
      first: 50
      after: $endCursor
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { id iid title state webUrl reference(full: true) workItemType { name } }
    }
  }
}
```

```graphql
# Filtered children of an Epic (Premium), 18.1+.
query PluginEpicChildren($group: ID!, $epic: WorkItemID!) {
  namespace(fullPath: $group) {
    workItems(includeDescendants: true, parentIds: [$epic], state: opened, first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes { id iid title workItemType { name } }
    }
  }
}
```

On 18.0, swap `namespace` for `project` or `group` and drop `parentIds`.

### Not verified

- **No live Instance was used.** Every behavior comes from source and docs. In particular, these were not run:
  - the empty default group list on Free;
  - the `null` group list on 18.0 Free;
  - glab's output in both of those cases (inferred: glab decodes a `null` connection as an empty list).
- **Inferred from finder code, not tested:**
  - `currentUser.workItems` leaving out group-level Epics;
  - children of an Epic that sit outside the queried group hierarchy not being returned.
- **18.0 sort behavior.** How 18.0 handles the sorts that later fall back to offset pagination was not checked; 18.0 has no fallback code.
- **Before 18.0.** Pre-17.2 versions of the core filters are bracketed only by reference docs at `.0` tags. The reference is generated from the EE schema. The 17.5 badge on `excludeProjects` predates its first appearance in the reference (17.9); the reason was not traced.
- **Archived projects before 18.5.** Whether items in archived projects were included in group lists before `includeArchived` existed (18.5) was not checked.
- **Licensing.** The tier of `customField` filtering was not checked. The MCP tools doc says `status` is "Ultimate only", while prior research has Status as Premium.
- **Performance.** How `currentUser.workItems` and wide `includeDescendants` queries perform on gitlab.com was not measured, and neither was the complexity multiplier on 18.x.
- **Release posts.** These and docs.gitlab.com were not read; both are blocked by egress policy.

## Sources

`gitlab-org/gitlab` (`https://gitlab.com/gitlab-org/gitlab/-/blob/<ref>/<path>#L<n>`). Refs: **RM** = master `099d3396543d8905fc820cb3fcc3104ce15f5170`; **R18.11** = `v18.11.0-ee`; **R18.0** = `v18.0.0-ee`.

GraphQL reference (`doc/api/graphql/reference/_index.md`):

- **G1** @ RM:
  - `Project.workItems` L61822-61888
  - `Group.workItems` L50387-50452 (no Experiment block)
  - `Namespace.workItems` L56041-56113
  - `CurrentUser.workItems` L42823-42878
  - `WorkItemConnection.count(limit:)` L33852-33862
  - `WorkItemWidgetHierarchy.children` L68707-68721
  - `AssigneeWildcardId.ME` L70622
  - `WorkItemParentWildcardId` L76021-76028
  - `WorkItemSort` L76040ff
  - `HierarchyFilterInput` L81029ff
  - `NegatedWorkItemFilterInput` L81225ff (`labelName` L81237, `parentIds` L81241)
  - `UnionedWorkItemFilterInput` L81743ff (L81749, L81752)
- **G2** @ R18.11:
  - `Query.issues` L1396-1403
  - Connections and pagination arguments L17674-17691
  - `WorkItemConnection` L27197-27221
  - `CurrentUser.workItems` L33725
  - `Group.workItems` L39401-39471
  - `Namespace.workItems` L44371-44441
  - `Project.workItems` L49015-49079
  - `AssigneeWildcardId` L56191-56197 (no `ME`)
  - `WorkItemParentWildcardId` L60635-60642
  - `WorkItemSort` L60654ff
  - `HierarchyFilterInput` L65019-65026
  - `NegatedWorkItemFilterInput` L65172ff (`parentIds` L65188)
  - `UnionedWorkItemFilterInput` L65503ff
- **G3** @ R18.0:
  - `WorkItemConnection` L20112-20123
  - `CurrentUser.workItems` L25018
  - `Group.workItems` L29380-29434
  - `Project.workItems` L37352-37402
  - `WorkItemWidgetHierarchy.children` L41887-41901
  - `AssigneeWildcardId` L42648
  - `NegatedWorkItemFilterInput` L49543ff
  - `UnionedWorkItemFilterInput` L49786ff
- **G4** Same file at every tag `v17.0.0-ee` … `v17.11.0-ee` (`index.md` before 17.9), `v18.1.0-ee` … `v18.10.0-ee`, `v19.0.0-ee` … `v19.4.0-ee`, and `v16.0.0-ee`. Argument tables were diffed tag by tag to get "Since". Specific lines:
  - v19.0.0-ee `Group.workItems` L40773 (no Experiment block);
  - v19.1.0-ee `AssigneeWildcardId` L59729 (no `ME`);
  - v19.2.0-ee `AssigneeWildcardId.ME` L63892.

GitLab source:

- **C1** Type definitions @ RM:
  - `app/graphql/types/project_type.rb` L422-429
  - `app/graphql/types/group_type.rb` L351-354 (@ R18.11 L348-352, with `experiment: { milestone: '16.3' }`)
  - `app/graphql/types/namespace_type.rb` L114-119
  - `app/graphql/types/current_user_type.rb` L35-39
  - `app/graphql/types/query_type.rb`: `issues` L109, `work_item` L251, `work_items_by_reference` L292, and no `work_items` list (same at R18.11 and R18.0)
- **C2** Commit `e16c24ab1016e7997c2b293e6b82209db57a1252`, "Promote work items from experiment", 2026-04-23, contained in `v19.0.0-ee`. Its diff removes `experiment:` from `Group.workItems`, `Group.workItem`, and `Group.workItemStateCounts` only.
- **C3** `app/graphql/resolvers/work_items_resolver.rb` @ RM: default sort L14-18; offset pagination for unstable sorts L38-45; Elasticsearch finder choice L50-59.
- **C4** `app/graphql/resolvers/namespaces/work_items_resolver.rb`:
  - @ RM: `GROUP_NAMESPACE_ONLY_ARGS` L9-16; `include_ancestors` and `include_descendants` (default `false`) L18-26; `exclude_projects` L28-32; `exclude_group_work_items` L34-39; `include_archived` L41-45; `ready?` returning `false` for user namespaces L51-57; finder arguments and `non_archived` L61-72. Unchanged at R18.11. The same `ready?` shape is present at v18.1.0-ee through v18.10.0-ee.
  - @ R18.0: L25-29, where `ready?` also requires `namespace_work_items_enabled?`. That method is defined in `app/models/group.rb` L1081-1083 (`namespace_level_work_items` flag) and `ee/app/models/ee/group.rb` L300-307 (`work_item_epics` flag plus the `epics` license).
  - Flag definitions: `config/feature_flags/development/namespace_level_work_items.yml` (default off) and `ee/config/feature_flags/beta/work_item_epics.yml` (default on), both @ R18.0.
- **C5** `app/graphql/resolvers/work_items/user_work_items_resolver.rb` @ RM: L24-31 (at least one filter required) and L33-35 (finder with no parent). Same at R18.0 and R18.11.
- **C6** `app/graphql/resolvers/concerns/work_items/shared_filter_arguments.rb`:
  - @ RM (identical at R18.11): `MAX_FIELD_LIMIT` L8; `ids` L11-16; `author_username` L17-20; `assignee_usernames` L26-29; `assignee_wildcard_id` L30-32; `label_name` L33-36; `milestone_title` L37-40; `milestone_wildcard_id` L41-43; `state` L53-61; `types` L62-66; `work_item_type_ids` L67-72; `not` L106-111; `or` L112-117; `hierarchy_filters` L119-122; `parent_ids` L124-128; `parent_wildcard_id` L130-133; `include_descendant_work_items` L135-138; mutual exclusions L155-163.
  - @ R18.0: L8-103, with no parent arguments.
  - @ `v18.1.0-ee`: `parent_ids` L101-104; limit checks L124-131.
- **C7** Filter input types @ RM, all under `app/graphql/types/work_items/`:
  - `negated_work_item_filter_input_type.rb` L8-57 (`parent_ids` with `experiment: 18.3` L34-40)
  - `unioned_work_item_filter_input_type.rb` L8-22
  - `hierarchy_filter_input_type.rb` L8-22
  - `parent_wildcard_id_enum.rb` L9-10
- **C8** `app/graphql/types/assignee_wildcard_id_enum.rb` @ RM L8-10, where `ME` is added by commit `94dd58fc`, "Support querying issues by current user", 2026-07-03.
- **C9** Finder and licensing:
  - `app/finders/work_items/work_items_finder.rb` @ RM (same line numbers at R18.11): parent filters L79-113; `accessible_projects` with "group-level work items are not supported in CE" L115-128; `include_group_work_items?` false L140-142.
  - `ee/app/finders/ee/work_items/work_items_finder.rb` @ RM (same at R18.11): `by_parent` L38-53; `related_groups` L82-92; `include_group_work_items?` L95-100.
  - `app/models/namespace.rb` L955-957 (`supports_work_items?`).
  - `app/models/work_items/types_framework/provider.rb` L61-66 (empty for groups in CE).
  - `ee/app/models/ee/work_items/types_framework/provider.rb` L26-33 and L251-261 (Epic added only with the `epics` license).
  - @ R18.0: `app/finders/work_items/work_items_finder.rb` L70-139.
- **C10** Filter semantics @ RM:
  - `app/finders/issuables/label_filter.rb` L37-96 (identical at R18.11)
  - `app/finders/issuables/assignee_filter.rb` L21-77 (`ME` branch L27-28 is absent at R18.11)
  - `app/models/concerns/milestoneable.rb` L24-25
  - `app/finders/issuable_finder.rb` L498ff
  - `app/finders/issues_finder.rb` L218-254 and `app/finders/issues/issue_types_filter.rb` L13-17 (types, `WHERE issue_type IN`)
- **C11** Pagination and limits:
  - `app/graphql/gitlab_schema.rb` `default_max_page_size 100`: RM L33, R18.11 L31, R18.0 L28.
  - `doc/api/graphql/_index.md` @ RM L349 and L356-361 (@ R18.11 L355): maximum page size and complexity 250.
  - `doc/api/graphql/getting_started.md` L405-409 @ RM and R18.11 (R18.0 L398): default 100 per page.
  - `app/graphql/resolvers/concerns/work_items/non_stable_cursor_sort_options.rb` @ RM L5-17, added by commit `ef59981d` (2025-05-20) and absent at R18.0.
  - `app/graphql/resolvers/base_resolver.rb` L126-153 and `app/graphql/types/base_field.rb` L184-192 @ RM: complexity.
  - `app/models/work_items/sorting_keys.rb` L5.
- **C12** `app/graphql/types/work_items/widgets/hierarchy_type.rb` L25-28 and `app/graphql/resolvers/work_items/children_resolver.rb` L9-19 @ RM.
- **C13** Elasticsearch routing @ RM:
  - `ee/lib/ee/search/advanced_finders/work_items_finder.rb` L89-90, L121-126, L379-393
  - `config/feature_flags/ops/glql_es_integration.yml` (default on)
  - `config/feature_flags/gitlab_com_derisk/work_items_list_es_integration.yml` (default off)
- **C14** `ee/app/graphql/ee/resolvers/work_items_resolver.rb` @ RM L12-53: the EE-only filter arguments.

GitLab MCP server @ RM. Identical at `v19.4.0-ee` except error handling in the tool class.

- **M1** `app/services/mcp/tools/work_items/list_work_items_service.rb`: sort and type values L7-11; description L16-23; input schema L24-115.
- **M2** `app/services/mcp/tools/work_items/list_work_items_tool.rb`: `agent_filters` L41-58; single scope L62-67.
- **M3** `app/services/mcp/tools/work_items/work_items_query_builder.rb`: filter definitions L15-46; query L100-140; scope defaults and page size L176-181; compact selection L193-207.
- **M4** `app/services/mcp/tools/concerns/cursor_pagination.rb`: L7-9 (default 20, maximum 100).
- **M5** `ee/app/services/ee/mcp/tools/work_items/list_work_items_tool.rb` L13-18 and `ee/app/services/ee/mcp/tools/work_items/list_work_items_service.rb` L36-58.
- **M6** `doc/user/model_context_protocol/mcp_server_tools.md` @ RM: `list_work_items` L1776-1813, "Introduced in GitLab 19.4" (@ v19.4.0-ee: L1388).

glab, `gitlab-org/cli` @ `v1.123.0` (commit `5686d7484e65cb08b6e3b92f86d2ccffb415bdc0`), `https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/<path>`:

- **L1** `internal/commands/workitems/list/list.go`: JSON pagination L38-49; flags L112-117; validation L136-147; fetch L163-164.
- **L2** `internal/commands/workitems/api/api.go`: group and project queries L39-87; type uppercasing L106-113; variables L115-133.
- **L3** `docs/source/work-items/list.md`: EXPERIMENTAL L13-25; options L65-76.
- **L4** `internal/commands/workitems/utils/scope.go`: L12-34.
- **L5** `docs/source/api/_index.md`: `--field @file` L62-63; `--paginate` requirements L124-128.

Prior research in this repo (read with `git show <branch>:<path>`):

- **P1** `research/gitlab-work-items-api`: `docs/research/gitlab-work-items-api.md`. Covers tiers per license feature, Experiment policy, and the REST Work Items API behind the off-by-default `work_item_rest_api` flag.
- **P2** `research/glab-cli-work-items`: `docs/research/glab-cli-work-items.md`. Covers `glab api graphql --paginate` behavior.
- **P3** `research/gitlab-official-mcp-server`: `docs/research/gitlab-official-mcp-server.md`. Covers MCP availability by version and tier, and authentication.
