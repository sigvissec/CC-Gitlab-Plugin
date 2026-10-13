# What can GitLab's Work Items API do, and where is it gated?

Research for ticket `01-gitlab-work-items-api` (GitLab Work Items plugin map). Researched 2026-10-13.

Terms follow `/GLOSSARY.md`. GitLab's API calls a Comment a **note** and a Thread a **discussion**. Those API names show up below only where they are literal identifiers.

**What was read.** Everything here comes from the `gitlab-org/gitlab` repository (`doc/` plus source), pinned to three refs:

- **`v18.11.0-ee`** (commit `8be8c00d`): the last 18.x minor, and the main reference. Cited as `path#Lnn`; the URL form is `https://gitlab.com/gitlab-org/gitlab/-/blob/v18.11.0-ee/<path>#L<nn>`.
- **`v18.0.0-ee`** (commit `6734ea03`): the 18.x baseline.
- **`master` at commit `099d3396`** (`VERSION` = `19.5.0-pre`, 2026-10-13): what gitlab.com runs now.

docs.gitlab.com and about.gitlab.com are blocked by this session's egress policy. Doc pages were therefore read from `doc/` in the repo at those refs. That is the same Markdown docs.gitlab.com renders (for example, `doc/api/graphql/reference/_index.md` is `https://docs.gitlab.com/api/graphql/reference/`). Release posts could not be read. Version facts come from the docs' own history and "Introduced in" badges, which are where GitLab records them.

## Answer

- **Build on the GraphQL Work Items API (`/api/graphql`). It is the only surface that covers all three types.** Issues, Tasks, and Epics get the same reads, Edits, Hierarchy, Linked Items, Comments, Thread resolution, and creation. These are `workItem` / `namespace.workItem`, `workItemCreate`, `workItemUpdate`, `workItemAddLinkedItems`, `createNote`, `createDiscussion`, and `discussionToggleResolve`. Every Edit field the plugin needs is already an input in 18.0 [O1].
- **The whole Work Items GraphQL API is still marked "Experiment".** That holds in every 18.x release and on master (19.5-pre) [S1 L2584, M1 L3193]. GitLab's policy says Experiment items "can be removed or changed at any time without notice" [S2 L285-292]. The issue tracking GA is still open with no milestone [I1]. The plugin must expect schema drift: pin its queries, test against real versions, and fail loudly.
- **Mutations take a global ID; people give URLs and IIDs.** Mutations need `gid://gitlab/WorkItem/<id>` [S1 L62310]. Resolve an IID with `namespace(fullPath:).workItem(iid:)`, which works for both projects and groups [S1 L44242]. Resolve URLs and references with `workItemsByReference(contextNamespacePath:, refs:)`, which accepts up to 10 at a time [S1 L2650, C10].
  - An Issue's or Task's work-item ID equals its issue ID, because they are the same database row [C4].
  - A legacy Epic ID is a different number from the Epic's work-item ID. Only the IID matches [S3 L77, S4 L28-32].
- **PAT scopes:** `read_api` is enough for Review (queries); `api` is needed for anything that writes [S2 L114-121]. Fine-grained PATs (beta, 18.10) are documented for REST endpoints only, so they are not a basis for v1 [S19].
- **Free tier covers Issues and Tasks fully.** That includes:
  - reading;
  - editing title, description, labels, one assignee, milestone, state, due date, and parent (Task under Issue);
  - Comments, replies, and resolving Threads;
  - "relates to" Linked Items;
  - creating Issues and Tasks.
- **Free cannot do:**
  - Epics at all;
  - weight;
  - multiple assignees;
  - blocks / blocked-by links;
  - an Epic as an Issue's parent.

  Nested Epics need Ultimate [C1, C2, S10, S12, S13, S14].
- **Epics: use only Epic Work Items.**
  - Epic Work Items became generally available in 18.1. On 18.0 they sit behind `work_item_epics`, which has been on by default since 17.7 [S3, S10].
  - The legacy Epic GraphQL API (`Group.epic`, `createEpic`, `updateEpic`) has been deprecated since 17.5. It was "planned for removal in 19.0" but is still in master's schema [S3 L55, M1 L8629, L48933].
  - The legacy Epic REST API has been deprecated since 17.0, with removal set for "API v5" and no date [S4].
- **The legacy REST Issues API is a real fallback for Issues and Tasks, not for Epics.** It works because Tasks are rows in the same table (`issue_type=task`).
  - It covers most Edit fields (labels by name), Comments, and Threads [S5, S6, S7].
  - It cannot set a Task's parent.
  - It reaches Epics only through the deprecated Epic API.
  - Resolving a Thread on an Issue over REST exists in the source but is not documented [C5].
  - A new REST Work Items API exists (18.9+) but sits behind the `work_item_rest_api` flag, which is `wip` and off by default on master too. It has no update endpoint [C12, C13, M2, I2].
- **gitlab.com and self-managed share one API.** What differs:
  - **Licensing:** checked per top-level group plan on gitlab.com, per instance license on self-managed [C3].
  - **Version:** gitlab.com runs 19.x code today; a self-managed Instance is pinned to an 18.x minor.
  - **Feature flags:** only self-managed admins can change them.
  - **CE installs:** the schema has no EE inputs at all, for example `weightWidget` [C7].
  - **Relative URL roots:** possible only on self-managed [S21].
- **Write-path gotchas that shape the design:**
  - **Type IDs:** `workItemCreate` needs a `workItemTypeId`, looked up per namespace [C9, S3].
  - **Comment vs Thread:** a top-level `createNote` makes a Comment that cannot be resolved. Use `createDiscussion` to start a Thread [C6].
  - **Unlicensed widgets:** sending a widget input the type lacks on this tier fails the whole mutation [C7].
  - **Silent drops:** some Edits are dropped with no error, such as extra assignees on Free or metadata changes without permission. Re-read after every write [C8].
  - **No optimistic locking:** there is no lock-version input anywhere. `WorkItem.lockVersion` can be read but not sent [S1 L54246, L17398].

## Detail

### API surfaces at a glance

| Surface | Covers | Status in 18.x | Use in plugin |
|---|---|---|---|
| GraphQL Work Items (`workItem*`, `namespace.workItem`) plus generic Comment/Thread mutations (`createNote`, `createDiscussion`, `updateNote`, `discussionToggleResolve`) | Issues, Tasks, and Epics: all reads, Edits, Hierarchy, Linked Items, Comments, Threads, creation | Experiment (exempt from deprecation policy) [S1, S2 L285-292] | Primary |
| GraphQL legacy Issue (`project.issue`, `updateIssue`, `issueSet*`) | Issues only, issue-shaped | Stable, not deprecated [S1] | Not needed |
| GraphQL legacy Epic (`group.epic(s)`, `createEpic`, `updateEpic`) | Epics only, no Tasks or Linked Items across types | Deprecated 17.5; removal planned 19.0, still present at 19.5-pre [S1 L38050, L6288, M1] | Avoid |
| REST Issues, Notes, Discussions, Issue links (`/projects/:id/issues/:iid…`) | Issues and Tasks; no Epics; no Task parent | Stable, Free [S5, S6, S7, S8] | Fallback |
| REST Epics, Epic notes and discussions, Epic issues (`/groups/:id/epics…`) | Epics (legacy IDs) | Deprecated 17.0, removal in API v5 [S4, S6 L550-570] | Avoid |
| REST Work Items (`/projects/:id/-/work_items`, also under `/groups/` and `/namespaces/`) | List, show, create, delete; **no update** | `wip` flag `work_item_rest_api`, default off (18.9; still off on master) [C12, C13, M2] | Not viable for v1 |

### How a Work Item is identified

- **Global ID.** `gid://gitlab/WorkItem/<id>` is the `WorkItemID` scalar.
  - It still accepts `gid://gitlab/Issue/<id>` "temporarily", and that can be "removed without notice" [S1 L62310-62317].
  - `WorkItem < Issue` and `table_name = 'issues'`, so the numeric ID is the same as the REST Issues `id` [C4].
  - Every Work Item mutation identifies its target by global ID [S1 L17398ff].
- **IID.** IIDs are numbered per namespace: `has_internal_id :iid, scope: :namespace` [C4 issue.rb L89].
  - Issues and Tasks in one project share one sequence.
  - Epics share the sequence of their group.
  - A legacy Epic keeps its IID as a Work Item, but its legacy ID differs [S3 L77].
  - The legacy Epic REST response carries `work_item_id`, and GraphQL `Epic.workItemId` maps one to the other [S4 L28-32, S1 L35585].
- **URL.** Work Item pages are `/<project>/-/work_items/<iid>` and `/groups/<group>/-/work_items/<iid>`.
  - Since 18.10, `/issues/:iid` and `/epics/:iid` URLs redirect to `/work_items/:iid` [S9 L44-57].
  - Global IDs in `/work_items/` paths were dropped in 16.0 [master `data/deprecations/15-10-global-id-work-items-route.yml`].
- **Resolving one form to another:**
  - **Path + IID to Work Item:** `namespace(fullPath: "group/project") { workItem(iid: "42") { id … } }` (a group path works the same way), available since 16.10 [S1 L44242]. GitLab's own Work Item UI uses this [C15 `work_item_by_iid.query.graphql`]. `Group.workItem(iid)` (16.4) and `Project.workItems(iid:)` also exist [S1 L39277, L49015].
  - **Global ID to Work Item:** `workItem(id:)` (15.1) [S1 L2584]. Read back `iid`, `namespace { fullPath }`, `webUrl`, and `reference(full: true)` [S1 L54224-54275].
  - **URL or short reference to Work Item:** `workItemsByReference(contextNamespacePath:, refs:)` (16.7) [S1 L2650].
    - It accepts work-item, issue, and Epic references and URLs (`#1`, `path#1`, `&1`, `/epics/`) [C10 L47].
    - It takes at most 10 refs [C10 L8].
    - Results come back as a list, not matched to the input refs.
    - It calls `authorized_find!(context_namespace_path)`, so leaving out the context probably errors. That is inferred from the source and was not tested.
- **Type IDs.** `workItemTypeId` (`gid://gitlab/WorkItems::Type/<n>`) is required to create a Work Item [C9 L76].
  - Get it from `namespace(fullPath:) { workItemTypes { nodes { id name } } }`. This is how the migration guide [S3] and GitLab's UI [C15] do it.
  - In source the system types have fixed IDs: Issue = 1, Task = 5, Epic = 8 [C11; and `app/models/work_items/type.rb` L39-48 at v18.0.0-ee]. The docs still say the ID "is not guaranteed to be the same between GitLab instances or namespaces" [S3]. Look it up and cache it; do not hard-code it.
  - The `workItemTypes(name:)` filter is deprecated in 19.0 because types become configurable [S1 L44368], so match on `name` client-side instead.

### Capability table

Abbreviations: **WIU** = `workItemUpdate(input: { id: <WorkItemID>, … })`, **WIC** = `workItemCreate(input: { namespacePath:, workItemTypeId:, title:, … })`. "Since" is the version the schema item was introduced; every item listed exists in 18.0 unless noted [O1]. Scope means classic PAT scope [S2 L114-121, S18 L145-146].

| Capability | GraphQL (key query/mutation and inputs) | Since | Tier | Identified by | Scope | REST fallback (Issues/Tasks only unless noted) |
|---|---|---|---|---|---|---|
| **Read** core fields (title, description, state, type, author, dates, `webUrl`, `userPermissions`) | `namespace(fullPath).workItem(iid)` or `workItem(id)`; `description`, `state`, `workItemType { name }` | 16.10 / 15.1 | Free | path + IID / GID | `read_api` | `GET /projects/:id/issues/:iid` [S5] |
| Read fields | `widgets { … on WorkItemWidgetLabels / Assignees / Milestone / StartAndDueDate / Weight / Status }` (`onlyTypes:` filters) [S1 L54277-54288] | pre-18 | Weight Premium; Status Premium (18.4 GA) [S14, S15] | as above | `read_api` | same response |
| Read **Threads** | `WorkItemWidgetNotes.discussions(filter: ONLY_COMMENTS)` → `Discussion { id replyId resolvable resolved notes { body author } }` [S1 L55053-55081, L35058-35073] | pre-18 | Free | as above | `read_api` | `GET …/issues/:iid/discussions` [S6] |
| Read **Hierarchy** | `WorkItemWidgetHierarchy { parent ancestors children(state:) hasChildren }` [S1 L54938-54970] | pre-18 | Free (Epic links only exist on Premium+) | as above | `read_api` | Only the Issue's `epic` attribute (legacy Epic ID); nothing for Tasks [S5] |
| Read **Linked Items** | `WorkItemWidgetLinkedItems.linkedItems(filter: RELATED/BLOCKS/BLOCKED_BY)` → `{ linkType workItem }` [S1 L54995-55029, L41030] | 16.3 | Free; blocking Premium | as above | `read_api` | `GET …/issues/:iid/links` [S8] |
| Edit **title** | WIU `title` | 15.1 | Free | GID | `api` | `PUT …/issues/:iid` `title` [S5 L1194-1235] |
| Edit **description** | WIU `descriptionWidget: { description }` (top-level `description` deprecated 16.9) [S1 L65811, L16922] | pre-18 | Free | GID | `api` | `description` |
| Edit **labels** | WIU `labelsWidget: { addLabelIds, removeLabelIds }` (Label GIDs; look up with `project.labels(searchTerm:, includeAncestorGroups:)` or `group.labels(…)`) [S1 L65862-65869] | pre-18 | Free (scoped labels Premium) | GID | `api` | `labels` / `add_labels` / `remove_labels` **by name** |
| Edit **assignees** | WIU `assigneesWidget: { assigneeIds }`, which **replaces** the set (User GIDs via `users(usernames:)`) [S1 L65737-65743] | pre-18 | Free = 1 assignee; Premium = many [C1 L67] | GID | `api` | `assignee_ids` (several: Premium) [S5 L1029-1060] |
| Edit **milestone** | WIU `milestoneWidget: { milestoneId }` (look up with `project.milestones(searchTitle:, includeAncestors:)` or `group.milestones(…)`) [S1 L65880-65886] | pre-18 | Free | GID | `api` | `milestone_id` (`0` unsets) |
| Edit **state** | WIU `stateEvent: CLOSE \| REOPEN` [S1 L60707-60714] | pre-18 | Free | GID | `api` | `state_event=close\|reopen` |
| Edit **weight** | WIU `weightWidget: { weight }` [S1 L65960-65966]; argument exists only in the EE schema [C7 ee create.rb L11] | pre-18; Epic weight editable from 18.11 [S14 L15-19] | Premium [C1 L62, S14] | GID | `api` | `weight` (Premium) |
| Edit **due date** | WIU `startAndDueDateWidget: { dueDate, startDate, isFixed }` [S1 L65914-65922]. Epic dates roll up from children unless `isFixed: true` [S3, `doc/user/group/epics/manage_epics.md` L54-63] | pre-18 | Free | GID | `api` | `due_date` |
| Edit **parent** | WIU `hierarchyWidget: { parentId }` (`null` removes) [S1 L65835-65844]; also `workItemHierarchyAddChildrenItems` (18.2) and `workItemsHierarchyReorder` (17.3) [S1 L17092, L17567] | pre-18 | Task→Issue Free; Issue→Epic Premium; Epic→Epic Ultimate [C2 L32-36, S12 L226-233] | GID (parent too) | `api` | Issue→Epic only via `epic_id` (legacy Epic ID, Premium); Task parent impossible |
| Post **Comment** | `createNote(input: { noteableId: <WorkItemID>, body, internal })` [S1 L6451-6478] | pre-18 | Free | GID | `api` | `POST …/issues/:iid/notes` [S7 L155] |
| Start **Thread** | `createDiscussion(input: { noteableId, body, internal })` [S1 L6266-6286] | pre-18 | Free | GID | `api` | `POST …/issues/:iid/discussions` [S6] |
| **Reply** in Thread | `createNote(input: { noteableId, discussionId: <Discussion.replyId>, body })` [S1 L6466, L35068] | pre-18 | Free | GID + DiscussionID | `api` | `POST …/discussions/:discussion_id/notes` [S6] |
| Edit own Comment | `updateNote(input: { id: <NoteID>, body })` [S1 L15692] | pre-18 | Free | NoteID | `api` | `PUT …/notes/:note_id` |
| **Resolve Thread** | `discussionToggleResolve(input: { id: <DiscussionID>, resolve: true\|false })` [S1 L7800-7820] | Issues 16.7 GA, Tasks 17.3, Epics 18.1 GA [S16 L341-351] | Free | DiscussionID | `api` | Exists in source but undocumented: `PUT …/issues/:iid/discussions/:id?resolved=true` [C5] |
| Add/remove **Linked Item** | `workItemAddLinkedItems(input: { id, workItemsIds (≤10), linkType })`, `workItemRemoveLinkedItems` [S1 L16801, L17119] | 16.3 | `RELATED` Free; `BLOCKS`/`BLOCKED_BY` Premium [S13 L30-36, C14] | GIDs | `api` | `POST …/issues/:iid/links` with `link_type` [S8 L206] |
| **Create Issue** | WIC with project `namespacePath`, Issue type ID, plus any widget inputs [S1 L16922-16968] | 15.1 | Free | path + type GID | `api` | `POST /projects/:id/issues` [S5 L1029-1060] |
| **Create Task** | WIC with Task type ID and `hierarchyWidget: { parentId: <Issue GID> }` [S1 L65827-65833] | 15.1 | Free [S11] | path + type GID | `api` | `issue_type=task`, but no parent; set it later over GraphQL |
| **Create Epic** | WIC with **group** `namespacePath` and Epic type ID [S3] | 15.1 schema; Epic type GA 18.1 | Premium [S10] | group path + type GID | `api` | Deprecated `POST /groups/:id/epics` [S4] |

Notes on the table:

- **Comment vs Thread.** `createNote` without `discussionId` creates a plain `Note`. Only `DiscussionNote` and `DiffNote` can be resolved [C6 `resolvable_note.rb` L7]. `createDiscussion` sets `type: 'DiscussionNote'` [C6 `create/discussion.rb`].
  - Replying to a plain Comment turns it into a Thread (`convert_to_discussion!`) [C6 `build_service.rb` L13-20].
  - So for every Comment it posts, the plugin must choose between "Comment" and "start a Thread".
- **Mutation errors.**
  - A widget input the type lacks on this tier makes the whole mutation fail. The error reads "Following widget keys are not supported by <Type> type" [C7 `widgetable.rb` L8-17].
  - On CE, EE-only arguments such as `weightWidget` are not in the schema at all, so the query fails validation.
- **Silent drops.**
  - On Free, `assigneeIds` is cut to its first ID.
  - Assignees who cannot read the item are dropped.
  - Without `set_work_item_metadata`, the assignee change is skipped with no error [C8 `assignees.rb` L16-27]. Date changes are skipped the same way [C8 `start_and_due_date.rb` L24].
  - Labels and milestone probably behave the same way through the shared issuable update path. That is unverified.
- **Planned read surface.** `WorkItem.features` (18.9, Experiment) is a typed alternative to `widgets` that returns `null` per missing widget [S1 L54241, L54320-54356]. The UI's switch to it is behind the `wip` flag `work_item_features_field` [C12]. Stay on `widgets` for 18.x.
- **Limits.** GraphQL allows at most 100 nodes per page, query complexity 250 when authenticated, 10,000 characters per query, and a 30 s timeout [S2 L355-360]. A full Review query (Threads with their Comments, children, and Linked Items) needs to paginate.
- **Roles.**
  - Guests can create items and Comment.
  - Editing metadata and resolving Threads needs Planner or higher. Guests can change only the title and description of items they authored or are assigned to [S17 L706-745].
  - The Threads page says resolving needs "Developer, Maintainer, or Owner … or be the author" [S16 L361]. That disagrees with the permissions table.
  - Use `WorkItem.userPermissions` and `Discussion.userPermissions.resolveNote` rather than hard-coded roles [S1 L54392-54413, L35075-35081].

### Tier gating (license feature → tier, from source)

| Capability | License feature | Tier | Source |
|---|---|---|---|
| Epic Work Item Type exists or can be created | `epics` | Premium | C1 L130; C2 L30 `LICENSED_TYPES` |
| Issue's parent can be an Epic | `epics` | Premium | C2 L32-36 `LICENSED_HIERARCHY_TYPES` |
| Epic's parent or child is an Epic | `subepics` | Ultimate | C1 L307; C2 L35; S12 L226-233 |
| Weight widget | `issue_weights` | Premium (legacy Starter list, included in Premium) | C1 L62, L358-359; C2 L16 |
| Multiple assignees | `multiple_issue_assignees` | Premium | C1 L67; `ee/app/models/ee/work_items/widgets/assignees.rb` |
| Blocking Linked Items | `blocked_issues` | Premium | C1 L53; C14 L10-13 |
| Status widget (not the same as open/closed state) | `work_item_status` (group-only) | Premium | C1 L211, L399-406; S15 |
| Iteration widget | `iterations` | Premium | C1 L63 |
| Health status widget | `issuable_health_status` | Ultimate | C1 L265 |
| Task under Issue, `RELATED` links, Comments, Threads, resolve | none | Free | S11, S12, S13, S16 |

Unlicensed widgets are removed from a type's widget list for that namespace [C2 L38-43]. On Free, reads simply leave them out.

**Detecting capability.**
- `namespace.workItemTypes { widgetDefinitions { type … on WorkItemWidgetDefinitionHierarchy { allowedParentTypes { nodes { name } } } } }` is resolved against the namespace, so it is license-aware [S1 L54766-54778; C11 `type_type.rb` L146-148].
- **The type list itself is not license-aware.** `workItemTypes` returns every type, Epic included, even where Epics are unlicensed. In 18.0 the code comment says "All groups/projects use all types for now" [O2 L18]. In 18.11 it returns all types unless the deprecated `onlyAvailable: true` is passed [C11 `types_finder.rb`].
- `WorkItemType.canUserCreateItems` (18.8, Experiment) is the replacement GitLab names [S1 L54537].

### Free tier and Epics specifically

- **On Free there is no Epic Work Item Type to create.** `workItemCreate` with the Epic type fails (resource not available) [C9 L131-141]. The legacy Epic REST API returns `403` when Epics are not available [S4].
- **On Free, the Hierarchy is only Task under Issue.** "Add issue to epic" and nested Epics are unavailable [C2, S12].
- **The two Epic APIs differ.** Use the Work Items API for Epics. The legacy Epic APIs have extra costs:
  - **Different ID:** they need the legacy Epic ID, not the work-item ID.
  - **No new features:** they get no new fields such as assignees, health status, or Linked Items across types [S3 L28-32].
  - **Deprecated:** GraphQL since 17.5, REST since 17.0 [S1 L38050, S4].
  - **Threads:** they cannot resolve Threads, because legacy `Epic` is not in `Noteable.resolvable_types` [C5 L19-21].
- **Epics in projects** (`project_work_item_epics`, beta) are off by default [C12]. Epics belong to groups.

### Feature flags that matter in 18.x

| Flag | State | Effect for the plugin |
|---|---|---|
| `work_item_epics` | Default on since 17.7 (self-managed), on gitlab.com since 17.6; **removed in 18.1** (GA) [S3, S10] | On **18.0** an admin could still turn it off, which disables Epic Work Items [O2 `ee/app/models/ee/work_items/type.rb` L115] |
| `work_item_status_feature_flag` | 18.2, GA and removed in 18.4 [S15] | Status widget (Premium); separate from state |
| `work_item_planning_view` | 18.7, GA and removed in 18.10 [S9 L40-45] | UI list only; `/issues/` and `/epics/` URLs redirect to `/work_items/` |
| `work_item_rest_api` | `wip`, default off (18.9; still off on master) [C12, M2, I2] | REST Work Items API returns `403` when off [C13 L79-82] |
| `work_item_features_field` | `wip`, default off (18.9) [C12] | UI moves from `widgets` to `features` |
| `work_item_configurable_types` | `wip`, default off (18.7) [C12] | Custom or renamed types; affects matching types by name |
| `project_work_item_epics` | `beta`, default off (17.10) [C12] | Epics inside projects |

Self-managed admins can toggle flags; gitlab.com flags are controlled by GitLab [S3 links to `doc/administration/feature_flags/_index.md`]. Per GitLab's policy, fields behind a default-off flag can change without notice [S2 L291-292].

### gitlab.com vs self-managed

- **Licensing basis.** With `should_check_namespace_plan?` (gitlab.com), a feature must be in both the instance license and the top-level group's plan. Otherwise the instance license alone decides [C3 L1003-1013].
  - Personal namespaces never get group-only features such as Status or custom fields [C3 L1004, C1 L399-406].
  - Epics live in groups, so a personal project has none.
- **Version skew.** gitlab.com tracks master (19.5-pre today), while a self-managed Instance is pinned to an 18.x minor. Read `metadata { version enterprise }` to branch on version and edition [S1 L43569-43572]. Items that matter within 18.x:
  - `Namespace.workItems` (18.1);
  - Epic Work Items GA (18.1);
  - `workItemHierarchyAddChildrenItems` (18.2);
  - Status GA (18.4);
  - `canUserCreateItems` (18.8);
  - URL redirects (18.10);
  - editable Epic weight (18.11).
- **CE vs EE.** A self-managed Community Edition schema has no EE types or arguments (Epic, `weightWidget`, `healthStatusWidget`, and others) [C7]. `metadata.enterprise` tells the two apart.
- **Base URL.** The endpoints are `/api/graphql` and `/api/v4` [S2 L31]. Self-managed can run under a relative URL such as `https://example.com/gitlab` [S21], so the plugin should store a base URL, not just a host.
- **Rate limits.** gitlab.com has its own limits. Notes and issue creation are rate-limited, and self-managed admins configure the values [S2 L358, S5 note under create].

### Does the legacy REST Issues API still work on Issues that are Work Items?

Yes, for Issues and Tasks. They are the same rows (`WorkItem < Issue`, table `issues`) [C4]. The Issues API accepts and filters `issue_type` values `issue`, `incident`, `test_case`, `task` [S5 L1052, L1231]. It is Free and carries no deprecation notice, even on master [S5; master `doc/api/issues.md`].

Limits as a fallback:

- No Epics. Group-level Work Items are not under `/projects/:id/issues`.
- `epic_id` uses the legacy Epic ID [S5].
- No way to set or read a Task's parent.
- Labels can be set by name, which is convenient.
- Thread resolution is documented for merge requests only [S6 L851, L1214-1243]. The source does register `PUT /projects/:id/issues/:iid/discussions/:discussion_id?resolved=` for Issues, because `Noteable.resolvable_types` includes `Issue` [C5]. Treat it as undocumented.
- Fine-grained PATs (beta) list Issues REST endpoints, so REST is the only path for a fine-grained token today [S19 L1436-1642].

Quick actions are a second fallback for name-based Edits. They are posted as a Comment body through `createNote`, for example `/label ~x`, `/assign @u`, `/milestone %m`, `/set_parent`, `/relate`, `/close`. `quickActionsStatus` reports the result [S20 L1886; S1 L6478]. A body made only of quick actions leaves no Comment behind [S1 L6452-6456].

### Not verified

- **Fine-grained PATs and GraphQL:** the token doc lists REST endpoints only; GraphQL support was not confirmed either way [S19].
- **REST Thread resolution on Issues:** found in source [C5], not documented, not run.
- **Silent label and milestone drops:** whether they are silently skipped for users without metadata permission, like assignees and dates are [C8], is inferred and not traced through the source.
- **`workItemsByReference` without `contextNamespacePath`:** inferred from source to error.
- **Epics after a downgrade:** what reads return for existing Epics after a license downgrade (Premium to Free) was not checked.
- **Release-post dates:** about.gitlab.com is blocked, so release posts were not read. Versions come from doc history badges and GraphQL "Introduced in" markers.
- **Legacy Epic GraphQL removal:** whether it was skipped in 19.0 or only postponed has no deprecation entry in `data/deprecations/` on master. All that is confirmed is that the fields are still in master's schema [M1].

## Sources

`gitlab-org/gitlab` at `v18.11.0-ee` unless marked otherwise. Base URL: `https://gitlab.com/gitlab-org/gitlab/-/blob/v18.11.0-ee/`.

Docs (rendered at `https://docs.gitlab.com/<path without doc/ and _index.md/.md>/`):

- **S1:** `doc/api/graphql/reference/_index.md` (GraphQL API reference). Lines are cited inline.
- **S2:** `doc/api/graphql/_index.md`: endpoint L31; token scopes L114-121; breaking-change exemptions L285-292; limits L355-360.
- **S3:** `doc/api/graphql/epic_work_items_api_migration_guide.md`: status L8-55; IID note L77; type-ID lookup ~L196.
- **S4:** `doc/api/epics.md` (deprecated Epic REST API, legacy vs work-item IDs): L1-32.
- **S5:** `doc/api/issues.md`: create L1029-1060; update L1194-1235.
- **S6:** `doc/api/discussions.md`: Issues L39-300; Epics deprecated L550-570; resolved is merge-request-only L851; merge request resolve L1214-1243.
- **S7:** `doc/api/notes.md`: issue notes L58-222; Epic notes L505-662.
- **S8:** `doc/api/issue_links.md`: tier L8-14; `link_type` L107, L206.
- **S9:** `doc/user/work_items/_index.md`: tier L9-13; unified list and redirects L38-57.
- **S10:** `doc/user/group/epics/_index.md`: tier L9-13; "Epics as work items" history L75-87.
- **S11:** `doc/user/tasks.md`: tier and history L9-24.
- **S12:** `doc/user/work_items/child_items.md`: tier L9-14; multi-level hierarchies (Ultimate) L226-233.
- **S13:** `doc/user/work_items/linked_items.md`: Free L9-14; blocking Premium L30-36.
- **S14:** `doc/user/work_items/weight.md`: Premium L9-13; Epics from 18.11 L15-19.
- **S15:** `doc/user/work_items/status.md`: Premium and history L9-19.
- **S16:** `doc/user/discussions/_index.md`: "Resolve a thread" L339-361.
- **S17:** `doc/user/permissions.md`: Issue and Task planning permissions L706-760; Epic permissions L237-246.
- **S18:** `doc/user/profile/personal_access_tokens.md`: scopes L141-146.
- **S19:** `doc/auth/tokens/fine_grained_access_tokens.md`: beta 18.10 L19-33; "REST API endpoints" L66; Work Item resources L1436-1642.
- **S20:** `doc/user/project/quick_actions.md`: `set_parent` L1886.
- **S21:** `doc/install/relative_url.md`: L1-25.

Source code:

- **C1:** `ee/app/models/gitlab_subscriptions/features.rb`: Starter/Premium/Ultimate lists L51-307; plan composition L358-360; group-only features L399-406.
- **C2:** `ee/app/models/ee/work_items/type.rb`: `LICENSED_WIDGETS`, `LICENSED_TYPES`, `LICENSED_HIERARCHY_TYPES` L14-43.
- **C3:** `ee/app/models/ee/namespace.rb`: `load_feature_available` L1003-1013.
- **C4:** `app/models/work_item.rb` (L3 `class WorkItem < Issue`, L14 `table_name = 'issues'`); `app/models/issue.rb` (L89 IID scope).
- **C5:** `app/models/concerns/noteable.rb` (L18-21 `resolvable_types`); `lib/api/discussions.rb` (L268-284 resolve endpoint).
- **C6:** `app/models/concerns/resolvable_note.rb` (L7); `app/graphql/mutations/notes/create/note.rb`; `app/graphql/mutations/notes/create/discussion.rb`; `app/services/notes/build_service.rb` (L13-20).
- **C7:** `app/graphql/mutations/concerns/mutations/work_items/widgetable.rb` (L8-17); `ee/app/graphql/ee/mutations/work_items/create.rb` (L11).
- **C8:** `app/services/work_items/callbacks/assignees.rb` (L16-27); `app/services/work_items/callbacks/start_and_due_date.rb` (L24).
- **C9:** `app/graphql/mutations/work_items/create.rb`: L56, L76, L131-141.
- **C10:** `app/graphql/resolvers/work_item_references_resolver.rb`: L8, L47.
- **C11:** type definitions and lookup:
  - `app/models/work_items/types_framework/system_defined/definitions/issue.rb` (L46) and `task.rb` (L41);
  - `ee/app/models/work_items/types_framework/system_defined/definitions/epic.rb` (L42);
  - `app/models/work_items/types_framework/provider.rb`;
  - `app/finders/work_items/types_finder.rb`;
  - `app/graphql/types/work_items/type_type.rb` (L146-148).
- **C12:** feature flag definitions:
  - `config/feature_flags/wip/work_item_rest_api.yml`;
  - `config/feature_flags/wip/work_item_features_field.yml`;
  - `config/feature_flags/gitlab_com_derisk/work_item_legacy_url.yml`;
  - `ee/config/feature_flags/beta/project_work_item_epics.yml`;
  - `ee/config/feature_flags/wip/work_item_configurable_types.yml`.
- **C13:** `lib/api/helpers/work_items/rendering.rb` (L79-82); `lib/api/work_items/{list,show,create,delete}.rb`.
- **C14:** `ee/app/services/ee/work_items/related_work_item_links/create_service.rb`: L10-13.
- **C15:** GitLab's own Work Item UI queries, under `app/assets/javascripts/work_items/graphql/`:
  - `work_item_by_iid.query.graphql`;
  - `namespace_work_item_types.query.graphql`;
  - `notes/create_work_item_note.mutation.graphql`;
  - `notes/toggle_work_item_note_resolve_discussion.mutation.graphql`.

Other refs:

- **O1:** `doc/api/graphql/reference/_index.md` at `v18.0.0-ee`: `Mutation.workItemUpdate` L12832-12871, with every Edit input already present.
- **O2:** at `v18.0.0-ee`:
  - `app/graphql/resolvers/work_items/types_resolver.rb` (L18 "All groups/projects use all types for now");
  - `ee/app/models/ee/work_items/type.rb` (L115 `work_item_epics` check);
  - `app/models/work_items/type.rb` (L39-48 fixed type IDs).
- **M1:** `doc/api/graphql/reference/_index.md` at master `099d3396` (19.5.0-pre): `Query.workItem` still Experiment L3193; `createEpic` deprecated but present L8629; `Group.epic` L48933; `Namespace.workItemTypes(name:)` deprecated 19.0 L56017.
- **M2:** `config/feature_flags/wip/work_item_rest_api.yml` at master `099d3396`: still `default_enabled: false`.
- **I1:** https://gitlab.com/gitlab-org/gitlab/-/issues/500620, "Remove experiment status from work items GraphQL API". Open, no milestone, updated 2026-10-12. Read through the gitlab.com REST API.
- **I2:** https://gitlab.com/gitlab-org/gitlab/-/work_items/588874, "[FF] work_item_rest_api". Open, rollout steps unchecked.
