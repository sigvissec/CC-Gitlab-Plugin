# How does GitLab expose the merge requests associated with a Work Item?

Research for ticket `17-associated-merge-requests` (GitLab Work Items plugin map). Researched 2026-10-14.

Terms follow `/GLOSSARY.md`. In the glossary, "Reference" means text that points at a Work Item. A merge request's own notation, such as `group/project!34`, is called a "merge request reference" here. GraphQL and REST identifiers keep GitLab's spelling. That includes `notes` and `discussions`, which this document otherwise calls Comments and Threads. GitLab's automatic activity entries ("mentioned in !34") are called **system notes**. They are not Comments.

**What was read.**

- **`gitlab-org/gitlab` source and `doc/`** at these refs:
  - `v18.1.0-ee` (commit `e0f3b864`): the plugin's minimum version.
  - `v18.11.0-ee` (commit `1060c7b0`): the last 18.x minor.
  - `v19.1.0-ee` to `v19.4.0-ee`, plus the `19-5-stable-ee` branch (commit `ff106d5d`). On 2026-10-14 only `v19.5.0-rc42-ee` was tagged, not 19.5.0.
  - `master` at `9469cc152b68cd327a127123aab721b6cc7bd6da` (2026-10-14, `VERSION` = `19.5.0-pre`), which is what gitlab.com runs.

  Files were read through a blobless sparse clone of master and through raw-file downloads at each tag. "Since" versions come from the GraphQL reference's "Introduced in" badges and from GitLab's commits API. For each commit, the API gives the first `vX.Y.0-ee` tag that contains it [C22].
- **glab** (`gitlab-org/cli`) at tag `v1.123.0` (commit `5686d748`), and its pinned dependency `gitlab-org/api/client-go` `v3.18.0`.
- **Prior research in this repo**, built on and not repeated: [P1] to [P4].

docs.gitlab.com is blocked by this environment's egress policy, so doc pages were read from `doc/` in the repo. Nothing was run against a live Instance. Citation keys in brackets point to the Sources list. `Lnn` is a line at that source's pinned ref.

## Answer

- **One widget holds everything: `WorkItemWidgetDevelopment`** (widget type `DEVELOPMENT`). Select it on a Fetched Work Item with `widgets(onlyTypes: [DEVELOPMENT]) { ... on WorkItemWidgetDevelopment { … } }`.
  - **Free tier:** it is not a licensed widget, so it works on Free and on CE [C12].
  - **Versions:** every field the plugin needs predates 18.0, so all of 18.1+ has them [G1 L43037-43050, C22].
  - **Token scope:** `read_api` is enough.
  - **Experiment status:** the whole Work Items read path is still Experiment, including `namespace.workItem` [G3 L55950-55957]. The policy implications are in [P1].
- **Merge requests that will close the Work Item: `closingMergeRequests`.** Each node is a `WorkItemClosingMergeRequest { fromMrDescription mergeRequest { … } }` [G1 L42615-42623].
  - **Status:** not Experiment and not behind a feature flag.
  - **What it includes:**
    - Merge requests in other projects.
    - Merge requests in any state. A row is written while the merge request is open and is not removed when the merge request merges or closes [C8].
    - Rows come from a closing pattern ("Closes #12") in the merge request's title, description, or commit messages, and only when the merge request targets the project's default branch [C8, D3].
    - Rows also come from manual links, which have `fromMrDescription: false`. Manual links are made with the `workItemAddClosingMergeRequest` mutation or the merge request's **Work items** widget [G1 L12807, D3 L372-376].
  - **Counts:**
    - `closingMergeRequests { count }` since 17.11.
    - A cheap `closingMergeRequestsCount` since 19.4.
  - **Lists:** it is safe in list queries, because GitLab preloads it [C5, C14, C22].
- **Merge requests that mention the Work Item: `relatedMergeRequests`.** This is a plain `MergeRequestConnection`.
  - **Status:** Experiment since 17.6; implemented in 17.7 [G1 L43048, C22].
  - **How GitLab builds it:** at query time it scans the description and every note for merge request references. The notes include the "mentioned in !34" system notes that GitLab adds when a merge request mentions the Work Item [C6, C17].
  - **One Work Item per request:** it can be resolved for only one Work Item per query. A second resolution in the same query returns a GraphQL error, and that field is `null` [C1, C13].
  - **Overlap:** closing merge requests usually show up here too. GitLab's own UI merges the two lists by merge request `id` [C18].
  - **19.4 and later:** it also returns merge requests explicitly linked as "relates to", when the `explicit_mr_work_item_relations` flag is on. That flag is `wip` and off in 19.4, and `beta` and on by default from 19.5 [C6, C21, D5].
- **Per merge request, both lists return the full `MergeRequest` type** [G1 L31601-31704, L31792-31802]. The fields a digest needs:
  - `reference(full: true)` → `group/project!34`. The default `reference` is a bare `!34` with no project [C16].
  - `title`.
  - `state`: `opened`, `closed`, `merged`, or `locked` [G1 L45848-45858].
  - `draft`.
  - `webUrl`.
  - `author { username name }`.

  Both are Relay connections: `first`/`after`, 100 per page at most and by default [D1, P2].
- **Issues and Tasks have the widget. Epics do not, on any version.** That holds at 18.1, 18.11, and master [C11].
  - `relatedMergeRequests` also returns nothing for group-level Work Items [C6].
  - A closing pattern never auto-closes a group-level Work Item [C8, C9].
  - For an Epic, the digest has nothing native to show. It would have to roll up from the Epic's child Issues (an inference, not a GitLab feature).
- **Merge requests the token cannot see are hidden, not redacted in place.** The plugin never sees a placeholder.
  - **Closing list:** each closing node needs `read_issue` on the Work Item and `read_merge_request` on the merge request [C3, C4].
  - **Related list:** it is filtered through `Ability.merge_requests_readable_by_user` before paging [C6, C15].
  - **Short pages:** GraphQL redaction happens after pagination, so a page can hold fewer than `first` nodes [D2].
  - **Counts can disagree with the nodes.** The counts use a looser SQL check: the merge requests feature is enabled, or the user is a Reporter. That check ignores project visibility. So `count` / `closingMergeRequestsCount` can exceed the nodes the token can open. This is inferred from source and not tested [C5].
- **Other associations in the same widget:**
  - **`relatedBranches`:** branches named `<IID>-…` in the Work Item's own project that have no merge request yet.
    - Each returns `name`, `comparePath`, and `pipelineStatus`.
    - Only one Work Item per request.
    - Needs `read_code` from 18.6 [C1, C7].
  - **`willAutoCloseByMergeRequest`** (17.2): a boolean [C10].
  - **`featureFlags`:** exists only in the EE schema [C2].
    - Linking a flag to an Issue needs Premium, or Service Ping features on self-managed, so the list is normally empty on Free [C12].
    - Selecting it on a CE Instance fails validation. Leave it out.
  - **Commits:** no field. A commit that mentions the Work Item leaves only a `cross_reference` system note ("mentioned in 54f7727c"), readable through the notes widget [C17].
- **Legacy surfaces:**
  - **GraphQL `Issue.relatedMergeRequests`:** same data as the widget on 18.x. It is not Experiment, but it is Issue-shaped and does not get the 19.4 explicit links [G2 L40531, C6].
  - **REST `GET /projects/:id/issues/:iid/related_merge_requests`:** same "mentioned" set, with offset pagination (`per_page` up to 100) [C19, D6, D7].
  - **REST `GET …/issues/:iid/closed_by`:** returns only closing merge requests **in the Work Item's own project**. It drops cross-project ones [C19, C20].
  - Both REST endpoints are project-scoped, so they cannot reach Epics.
  - Don't confuse the endpoint with the Issue JSON attribute `closed_by`, which is the *user* who closed the Issue [C19].
- **glab v1.123.0 and GitLab's MCP server add nothing the plugin can rely on.**
  - **glab:** no command lists a Work Item's merge requests.
    - `glab mr issues` goes the other way, from a merge request to the Issues it closes.
    - `glab issue view -F json` carries only `merge_requests_count`.
    - `glab api graphql` can send the queries below [L1, L2, P4].
  - **GitLab MCP server:** `get_work_item` with `include: ["related_merge_requests"]` (19.4+) returns only `relatedMergeRequests`.
    - It has no closing flag and no `reference`.
    - It returns 20 per page by default, up to 100.
    - It is empty for Epics.
    - 18.x has no equivalent [M1, M2]. Its authentication limits are in [P3].

**Recommendation for the digest (inference from the above).** Run one detail query per Work Item that selects `closingMergeRequests(first: 20)` and `relatedMergeRequests(first: 20)`. Merge the two on merge request `id`, and label each merge request "closes" or "mentions". Show `reference(full: true)`, `title`, `state`/`draft`, and `webUrl`. For a list of many Work Items, select only `closingMergeRequests` (or its `count`). For Epics, show nothing or roll up from children. If `relatedMergeRequests` errors or disappears (it is Experiment), fall back to closing merge requests only.

## Association kinds

"Since" is the first `.0` release with the field. Every row except the 19.x ones is in all 18.1+ releases. "Types" says which Work Item Types the field returns data for. Tier is the tier needed to *read* the field.

| Association | GraphQL field (under `WorkItemWidgetDevelopment` unless noted) | Since | Tier | Status | Types | Per merge request data | Pagination / limits | Hidden merge requests |
|---|---|---|---|---|---|---|---|---|
| Will close the Work Item (closing pattern in MR title, description, or commits targeting the default branch, or a manual link) | `closingMergeRequests` → `WorkItemClosingMergeRequest { fromMrDescription, mergeRequest: MergeRequest }` [G1 L42615-42623, C1] | 17.1 (17.0 under the name `relatedMergeRequests`) [C22] | Free | Stable field; no flag | Issue, Task. Epic: no widget [C11] | Full `MergeRequest`: `reference(full:)`, `title`, `state`, `draft`, `webUrl`, `author` [G1] | Relay, ≤100 per page; complexity 10; preloaded in lists [C1, C14, D1] | Dropped per node: needs `read_issue` and `read_merge_request` [C3, C4] |
| Count of closing merge requests | `closingMergeRequests { count }`; `closingMergeRequestsCount: Int!` [G3 L68761, L33886] | 17.11 / **19.4** [C22] | Free | Stable | Issue, Task | none | Batch-loaded, cheap in lists [C5] | Looser check; may count merge requests the token cannot open (inferred) [C5] |
| Auto-close pending | `willAutoCloseByMergeRequest: Boolean!` [G1 L43050] | 17.2 [C22] | Free | Stable | Issue, Task | none | none | Not filtered by user [C5 `auto_close_issue_ids` comment, C10] |
| Mentions the Work Item (in its description or notes, including "mentioned in !34" system notes) | `relatedMergeRequests` → `MergeRequestConnection` [G1 L43048] | 17.6 placeholder, 17.7 implemented [C22] | Free | **Experiment** (17.6) | Issue, Task. Returns none for group-level, so Epics never [C6] | Full `MergeRequest` | Relay, ≤100 per page; **one Work Item per request** [C1, C13] | Filtered before paging [C6, C15] |
| Explicit "relates to" link made on the merge request (19.1+ data) | Included in `relatedMergeRequests` from **19.4** [C6] | 19.4 | Free | Behind `explicit_mr_work_item_relations`: `wip` off in 19.4; `beta` on by default from 19.5 [C21, D5] | Issue, Task | as above | as above | as above |
| Branch named after the IID, with no merge request | `relatedBranches` → `WorkItemRelatedBranch { name, comparePath, pipelineStatus }` [G1 L42692-42700] | 17.6 [C22] | Free | Stable; Gitaly call | Issue, Task (own project only) [C7] | Branch, not a merge request | Array connection; **one Work Item per request** [C1] | Empty without `read_code` (18.6+) [C7] |
| Feature flag | `featureFlags` → `FeatureFlag` [C2] | 16.11 [C22] | Read: any. Creating links: Premium or Service Ping features [C12] | EE schema only (absent on CE) | Issue, Task | Flag, not a merge request | Relay | `read_feature_flag` per node [C2] |
| Commit that mentions the Work Item | none. Only `cross_reference` system notes via `WorkItemWidgetNotes.discussions(filter: ONLY_ACTIVITY)` [C17, G1 L43252] | n/a | Free | n/a | Issue, Task, Epic (system notes exist on group-level items too; inferred [C17]) | Note `body` such as "mentioned in 54f7727c" | Notes paging [P1] | Note-level visibility |
| Legacy Issue fields | `Issue.relatedMergeRequests`, `Issue.mergeRequestsCount` [G2 L40523, L40531] | pre-17 | Free | Stable, not Experiment | Issues reached through the legacy `project.issue`; Task coverage not checked | Full `MergeRequest` | One Issue per request (`relatedMergeRequests`) [C6] | Same as the widget, but no 19.4 explicit links |
| REST related | `GET /projects/:id/issues/:iid/related_merge_requests` [D6] | old | Free | Stable | Issue (Task: likely, unverified). No Epics | `Entities::MergeRequest`: `references`, `title`, `state`, `draft`, `web_url`, `author` [C19] | `page`/`per_page` ≤100 [D7] | Filtered [C6] |
| REST closing | `GET /projects/:id/issues/:iid/closed_by` [D6] | old | Free | Stable | as above | `MergeRequestBasic` [C19] | `per_page` ≤100 | **Same-project merge requests only** [C19, C20] |
| GitLab MCP | `get_work_item` with `include: ["related_merge_requests"]` [M1] | 19.4 | Free from 19.2 [P3] | MCP beta, GA in 19.5 [P3] | Issue, Task; "empty for … epics" | `id iid title state draft webUrl createdAt mergedAt author` (no `reference`) [M1] | Default 20, max 100 | as `relatedMergeRequests` |
| glab | none (only `glab mr issues`, the reverse direction) [L1] | none | none | none | none | `glab issue view -F json` gives only `merge_requests_count` [L2] | none | none |

## Detail

### Where the two merge request lists come from

- **Closing rows.** The rows live in table `merge_requests_closing_issues`. The model is `MergeRequestsClosingIssues` through 19.5; on master it was renamed to `MergeRequestIssue` (commit `9d5a0d24`, not yet in a release) [C22].
  - **While a merge request is open,** GitLab rebuilds its rows from `closes_issues`. That covers the title, the description, and the commit messages, and only when the target branch is the default branch [C8 R18.1 L1619-1655, L1679-1689].
  - **Manual rows** (`from_mr_description: false`) are kept across rebuilds [C8].
  - **Closed or merged merge requests** are skipped, so their rows stay. A merged merge request remains in `closingMergeRequests`, which is why the digest needs `state` [C8].
  - **Link types (19.1+).** The table gained a `link_type` column: `closes`, `mentioned`, `related`. The widget's association is scoped to `closes`, so `mentioned` and `related` rows never leak into `closingMergeRequests` [C9 v19.1.0-ee L96-99, RM L87-100; C5 RM L10].
- **Mentioned list.**
  - **What is scanned.** `Issues::ReferencedMergeRequestsService#referenced_merge_requests` runs the reference extractor over the Work Item's description and all of its notes [C6 R18.1 L17-31, L51-61].
  - **Why mentions show up.** When a merge request mentions a Work Item, GitLab posts a `cross_reference` system note on the Work Item ("mentioned in !34") [C17 L221-261, D4 L101]. So a merge request that only mentions the Work Item in its own description still appears.
  - **Cost.** The list is computed on every request, which is why GitLab allows only one Work Item per request [C1].
  - **19.4 and later.** The resolver unions in explicit `related` rows when the flag is on [C6 RM L54-65].
- **GitLab's UI does the same merge the plugin should.** It merges `closingMergeRequests.mergeRequest` and `relatedMergeRequests` with `unionBy(…, 'id')`, then groups them as merged, open, and closed [C18].

### Visibility, redaction, and counts

- **Rows are left out, never shown as placeholders.**
  - GraphQL collections are "filtered to exclude the objects that the user's authorization checks failed against". This filtering happens after pagination, so "some pages may be smaller than the requested page size" [D2 L25-31].
  - The plugin must page on `pageInfo.hasNextPage`, not on node count.
- **`closingMergeRequests`:** the `WorkItemClosingMergeRequest` type authorizes `read_merge_request_closing_issue`. That ability needs both `read_issue` on the Work Item and `read_merge_request` on the merge request [C3 L10, C4].
- **`relatedMergeRequests`:**
  - Merge requests the token cannot read are removed by `Ability.merge_requests_readable_by_user` before paging [C6, C15 L69-75].
  - With external authorization enabled on an Instance, `read_cross_project` is denied, and the list keeps only merge requests in the Work Item's own project [C6, C15 L184-190, base_policy L95-96].
- **Counts:**
  - `closingMergeRequests { count }`, `closingMergeRequestsCount`, `Issue.mergeRequestsCount`, and the REST `merge_requests_count` all use `MergeRequestIssue.count_for_collection` [C5].
  - For a non-admin, that function counts a row when `merge_requests_access_level >= ENABLED (20)` or when the user is at least a Reporter in the target project [C5 RM L31-39, L68-74; C15 featurable L26-29].
  - Private projects normally have the feature at `ENABLED`. So the count can include merge requests the token cannot open (inferred; not tested).
  - Show the count as "≥ visible" or derive it from the nodes.
- **`willAutoCloseByMergeRequest`** checks the raw closing rows with no visibility filter. It can be `true` when the only closing merge request is invisible [C5 RM L58-64, C10].

### Pagination and query limits

- **Page size.** `closingMergeRequests`, `relatedMergeRequests`, and `relatedBranches` are Relay connections with `first`/`after`. Without `first` they return 100, and 100 is the maximum [D1 L349-358, P2].
- **One Work Item per request.** `relatedMergeRequests` and `relatedBranches` carry `FieldCallCount limit: 1` [C1].
  - A second resolution raises `LimitError` (a `GraphQL::ExecutionError`) with the message `"relatedMergeRequests" field can be requested only for 1 WorkItemWidgetDevelopment(s) at a time.` [C13].
  - The rest of the response still returns.
  - glab exits 1 whenever the top-level `errors` array is non-empty [P4].
  - So never select these two fields in a list query.
- **Complexity.** Each of the three connection fields has complexity 10 (since 18.1). The authenticated limit is 250 [C1, D1]. The cost of a list query with nested `closingMergeRequests` was not measured. The plugin can read `queryComplexity` to check.
- **Nested paging.** `glab api graphql --paginate` follows only the first `pageInfo` in a response. A query that selects both lists has to page the second one itself [P4].

### Work Item Types

- **Widget lists:**
  - 18.1 (`WIDGETS_FOR_TYPE`): Issue L48 and Task L117 include `:development`; Epic L163-182 does not [C11].
  - 18.11 (system-defined types): `issue.rb` L19 and `task.rb` L18 include `development`; `epic.rb` L9-30 does not [C11].
  - Master: the same, at `issue.rb` L21, `task.rb` L20, `epic.rb` L9-31 [C11].
- **What an Epic query returns.** On an Epic, `widgets(onlyTypes: [DEVELOPMENT])` returns an empty list. The inline fragment matches nothing, and no error is raised. `features { development }` (18.9, Experiment) returns `null` [G3 L67978, L68139].
- **Group-level guards.** Even without the widget gap, `WorkItemRelatedResolver` returns `MergeRequest.none` for group-level items [C6 L10]. `autoclose_by_merged_closing_merge_request?` is `false` for them [C9 RM L1034-1038].
- **Other types.** The incident and ticket Work Item Types also have the widget on master [C11]. The plugin does not support those types.

### Version drift to plan for

| Version | Change |
|---|---|
| 18.1 | Baseline: `closingMergeRequests` (+ `count`), `relatedMergeRequests` (Experiment), `relatedBranches`, `willAutoCloseByMergeRequest`, `featureFlags` (EE) [G1] |
| 18.6 | `relatedBranches` empty without `read_code` [C7, C22] |
| 18.9 | Widget usable with the `ai_workflows` token scope; `WorkItem.features.development` (Experiment) [C22, G3] |
| 19.1 | `link_type` column; closing association scoped to `closes`; manual "relates to" links behind `explicit_mr_work_item_relations` (off) [C9, C21, D5] |
| 19.4 | `closingMergeRequestsCount`; `relatedMergeRequests` and REST `related_merge_requests` include explicit related merge requests when the flag is on [C6, C22] |
| 19.5 | Flag becomes `beta`, default on [C21, D5] |
| master (unreleased) | `WorkItemClosingMergeRequest.id` type changes from `MergeRequestsClosingIssuesID` to `MergeRequestIssueID` [G2 L54297, G3 L68062]. Do not select or parse `id`. |

## Example queries

All examples work on 18.1 and later with a `read_api` token. They use the same `namespace.workItem` entry point as [P1] and [P2].

**1. One Work Item's merge requests (detail Fetch).** Merge the two lists on `mergeRequest.id`.

```graphql
query PluginWorkItemMergeRequests($fullPath: ID!, $iid: String!) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) {
      id
      reference(full: true)
      workItemType { name }
      widgets(onlyTypes: [DEVELOPMENT]) {          # empty list for Epics
        ... on WorkItemWidgetDevelopment {
          willAutoCloseByMergeRequest
          closingMergeRequests(first: 20) {
            count                                   # 17.11+; may exceed visible nodes
            pageInfo { hasNextPage endCursor }
            nodes {
              fromMrDescription                     # false = linked manually
              mergeRequest { ...PluginMrDigest }
            }
          }
          relatedMergeRequests(first: 20) {         # Experiment; one Work Item per request
            pageInfo { hasNextPage endCursor }
            nodes { ...PluginMrDigest }
          }
        }
      }
    }
  }
}

fragment PluginMrDigest on MergeRequest {
  id
  reference(full: true)   # group/project!34 (default would be a bare !34)
  title
  state                   # opened | closed | merged | locked
  draft
  webUrl
  author { username }
}
```

**2. Next page of mentioning merge requests.** Page one connection at a time. glab's `--paginate` needs the cursor variable to be named `$endCursor` [P4].

```graphql
query PluginRelatedMrPage($fullPath: ID!, $iid: String!, $endCursor: String) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) {
      widgets(onlyTypes: [DEVELOPMENT]) {
        ... on WorkItemWidgetDevelopment {
          relatedMergeRequests(first: 100, after: $endCursor) {
            pageInfo { hasNextPage endCursor }
            nodes { id reference(full: true) title state draft webUrl }
          }
        }
      }
    }
  }
}
```

**3. Closing merge requests across a list of Work Items.** Leave out `relatedMergeRequests` and `relatedBranches`, which would error from the second item on. On 19.4+, `closingMergeRequestsCount` is the cheapest count.

```graphql
query PluginListWithClosingMrs($fullPath: ID!) {
  namespace(fullPath: $fullPath) {
    workItems(includeDescendants: true, state: opened, types: [ISSUE, TASK], first: 20) {
      pageInfo { hasNextPage endCursor }
      nodes {
        reference(full: true)
        widgets(onlyTypes: [DEVELOPMENT]) {
          ... on WorkItemWidgetDevelopment {
            closingMergeRequests(first: 3) {
              count
              nodes { mergeRequest { reference(full: true) state draft } }
            }
          }
        }
      }
    }
  }
}
```

**4. Commits that mention a Work Item (optional).** These exist only as system notes. Filter on `systemNoteMetadata.action == "cross_reference"` and a body such as `mentioned in 54f7727c` [C17, G1 L34538-34558, L43252].

```graphql
query PluginWorkItemCrossReferences($fullPath: ID!, $iid: String!) {
  namespace(fullPath: $fullPath) {
    workItem(iid: $iid) {
      widgets(onlyTypes: [NOTES]) {
        ... on WorkItemWidgetNotes {
          discussions(filter: ONLY_ACTIVITY, first: 100) {
            nodes { notes { nodes { body system systemNoteMetadata { action } } } }
          }
        }
      }
    }
  }
}
```

**5. REST fallback, Issues only.** `closed_by` misses merge requests from other projects.

```shell
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://<instance>/api/v4/projects/<url-encoded-path>/issues/12/related_merge_requests?per_page=100"
curl --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "https://<instance>/api/v4/projects/<url-encoded-path>/issues/12/closed_by?per_page=100"
```

**6. Through a reused glab login** [P4]. `-F name=@file` reads a file, and `-f` sends a string.

```shell
glab api graphql --hostname <instance> -F query=@work_item_mrs.graphql \
  -f fullPath=group/project -f iid=12
```

## Not verified

- **No live Instance was used.** Every behavior comes from source and docs. Candidate hand checks for the Free test Instance (ticket 05):
  - A query that selects `relatedMergeRequests` for two Work Items returns the `LimitError` for the second.
  - A closing merge request in a private project the token cannot see is absent from `nodes` but counted in `count`.
  - A merged closing merge request stays in `closingMergeRequests`.
  - `widgets(onlyTypes: [DEVELOPMENT])` on an Epic returns an empty list. This needs Premium, so it may not be checkable there.
  - The REST endpoints accept a Task IID.
- **Count over-reporting** is inferred from the SQL scope in [C5], not observed.
- **Order of `relatedMergeRequests` in GraphQL** was not traced. REST sorts by merge request IID [C6 `sort_by_iid`]. The GraphQL connection is built from `MergeRequest.id_in(ids)`.
- **Epic system notes.** That an Epic receives "mentioned in !34" system notes is inferred from `cross_reference` handling group-level noteables [C17 L239]. It was not checked.
- **Backports.** Whether the 18.6 `read_code` check on `relatedBranches` was backported to 18.1-18.5 patch releases was not checked.
- **`explicit_mr_work_item_relations` on gitlab.com.** GitLab controls its state there. The 19.5 doc says it is enabled on GitLab.com, Self-Managed, and Dedicated [D5]. 19.5.0 was not yet tagged, so `19-5-stable-ee` was read instead.
- **Feature flag tier.** The tier of feature flag ↔ Issue links comes from the license feature list [C12]. The feature flags user doc page was not read.
- **Complexity cost** of list queries that nest `closingMergeRequests` was not measured.
- **docs.gitlab.com and release posts** were not read (egress policy).

## Sources

`gitlab-org/gitlab`: `https://gitlab.com/gitlab-org/gitlab/-/blob/<ref>/<path>#L<n>`. Refs:

- **R18.1** = `v18.1.0-ee` (`e0f3b86408aa4e7f03b63ac9e7dba6de1df14e93`)
- **R18.11** = `v18.11.0-ee` (`1060c7b0ff78be7c8abe8fd6d23dcb1ca493fd78`)
- **R19.1** = `v19.1.0-ee` (`67581074a0aab1f53cdafe7eead5f5d07f3afec8`)
- **R19.4** = `v19.4.0-ee` (`fa703f93afaf1133cd263f6aa0e91d284d7f1ebf`)
- **S19.5** = `19-5-stable-ee` (`ff106d5d9572a87248ef75bcad640050cafe0546`)
- **RM** = master `9469cc152b68cd327a127123aab721b6cc7bd6da`

GraphQL reference (`doc/api/graphql/reference/_index.md`):

- **G1** @ R18.1:
  - `WorkItemWidgetDevelopment` L43037-43050 (`relatedMergeRequests` Experiment L43048)
  - `WorkItemClosingMergeRequest` L42615-42623
  - `WorkItemRelatedBranch` L42692-42700
  - `WorkItemClosingMergeRequestConnection` L20490-20501
  - `WorkItemRelatedBranchConnection` L20607-20617
  - `MergeRequest` fields: `author` L31601, `draft` L31629, `state` L31683, `title` L31695, `webUrl` L31704; `MergeRequest.reference(full:)` L31792-31802
  - `MergeRequestState` L45848-45858
  - `Namespace.workItem(iid: String!)` L34286
  - `WorkItem.reference(full:)` L42600
  - `widgets(onlyTypes:)` L42613
  - `WorkItemWidgetType.DEVELOPMENT` L47610
  - `Note.body`/`system`/`systemNoteMetadata` L34538-34558
  - `WorkItemWidgetNotes.discussions(filter:)` L43252
  - `Mutation.workItemAddClosingMergeRequest` (`mergeRequestReference` argument) L12807
- **G2** @ R18.11:
  - `WorkItemWidgetDevelopment` L54865-54878
  - `WorkItemClosingMergeRequest.id: MergeRequestsClosingIssuesID!` L54297
  - `Issue.mergeRequestsCount` L40523
  - `Issue.relatedMergeRequests` L40531
- **G3** @ RM:
  - `WorkItemWidgetDevelopment` L68752-68766 (`closingMergeRequestsCount` L68761)
  - `WorkItemClosingMergeRequest` L68055-68063 (`id: MergeRequestIssueID!` L68062)
  - `WorkItemRelatedBranch` L68235-68243
  - `WorkItemClosingMergeRequestConnection` L33878-33889
  - `MergeRequestConnection` L29311-29322
  - `Issue.mergeRequestsCount` L51669
  - `Issue.relatedMergeRequests` L51677
  - `MergeRequest.reference` L52800-52810
  - `MergeRequestState` L73729-73739
  - `Namespace.workItem` Experiment L55950-55957
  - `WorkItem.features` L67978
  - `WorkItemFeatures.development` L68139
  - Merge request side, for context: `MergeRequest.linkedWorkItems` (deprecated 19.2) L52740-52757 and `MergeRequest.workItemRelations` L52828-52842

GitLab source:

- **C1** `app/graphql/types/work_items/widgets/development_type.rb`:
  - @ R18.1: `closingMergeRequests` L15-19; `relatedBranches` with `FieldCallCount limit: 1` L20-27; `relatedMergeRequests` with `experiment: '17.6'` and limit 1 L28-37; `willAutoCloseByMergeRequest` L38-42; resolver methods L44-58.
  - @ R18.11: the same, plus `scopes: [:api, :read_api, :ai_workflows]` L35.
  - @ RM (identical at R19.4): L21-25, `closingMergeRequestsCount` L26-31, L32-39, L40-50, L51-55, L57-71.
- **C2** `ee/app/graphql/ee/types/work_items/widgets/development_type.rb` L11-23 (`featureFlags`), identical at R18.1, R18.11, and RM. `ee/app/graphql/types/feature_flag_type.rb` @ RM L7 (`authorize :read_feature_flag`).
- **C3** `app/graphql/types/work_items/closing_merge_request_type.rb` @ RM L8-21 (`authorize :read_merge_request_closing_issue` L10). @ R18.1: `id` typed `MergeRequestsClosingIssues` L16.
- **C4** `app/policies/merge_requests_closing_issues_policy.rb` @ R18.1 L6-12; `app/policies/merge_request_issue_policy.rb` @ RM L5-11.
- **C5** Counts and the closing model:
  - `app/graphql/types/work_items/widgets/connections/closing_merge_requests_connection_type.rb` L12-15
  - `app/graphql/resolvers/merge_requests_count_resolver.rb`: @ R18.1 L7-15; @ RM L7-29
  - `app/models/merge_requests_closing_issues.rb` @ R18.1: `accessible_by` L21-29, counts L40-55
  - `app/models/merge_request_issue.rb` @ RM: `link_type` enum L10, `accessible_by` L31-39, counts and `auto_close_issue_ids` L50-74
- **C6** Related merge requests:
  - `app/graphql/resolvers/merge_requests/work_item_related_resolver.rb`: @ R18.1 (identical at R18.11) L9-13 (`MergeRequest.none if resource.group_level?`); @ RM (identical at R19.4) L9-17
  - `app/graphql/resolvers/merge_requests/issue_related_resolver.rb` @ R18.1 L10-19
  - `app/services/issues/referenced_merge_requests_service.rb`: @ R18.1 L17-31 and L51-72; @ RM L17-30, L54-65 (flag-gated union), L67-79, L81-102
  - `app/graphql/types/issue_type.rb` @ RM L72-81
- **C7** `app/services/issues/related_branches_service.rb` @ RM: L7-14, L31-36 (excludes branches with a referenced merge request), L38-53 (`<iid>-*`, not `-stable`). `read_code` check added in commit `922a6e08` (first in 18.6).
- **C8** `app/models/merge_request.rb`:
  - @ R18.1: `cache_merge_request_closes_issues!` L1619-1655; `visible_closing_issues_for` L1657-1676; `closes_issues` L1679-1689
  - @ RM: L1894-1910, L1913-1929, L1931-1963; `to_reference` L1052-1056
- **C9** `app/models/issue.rb`:
  - @ R18.11 L93-96 (unscoped association)
  - @ R19.1 L96-99 (`-> { link_type_closes }`)
  - @ RM L87-100, `merge_requests_count` L880-882, `group_level?` / `autoclose_by_merged_closing_merge_request?` / `eligible_for_autoclose_by_merge_request?` L1030-1045
- **C10** `app/models/work_items/widgets/development.rb` @ RM L14-22. Identical at v19.3.0-ee. R18.11 differs in the association name (`merge_requests_closing_issues`, unscoped) and in an equivalent form of the auto-close condition.
- **C11** Widgets per type:
  - @ R18.1: `lib/gitlab/database_importers/work_items/base_type_importer.rb`, `WIDGETS_FOR_TYPE` L39-65 (Issue), L110-130 (Task), L163-182 (Epic)
  - @ R18.11: `app/models/work_items/types_framework/system_defined/definitions/issue.rb` L19, `task.rb` L18, `ee/app/models/work_items/types_framework/system_defined/definitions/epic.rb` L9-30
  - @ RM: the same files at `issue.rb` L21, `task.rb` L20, `epic.rb` L9-31
- **C12** Licensing:
  - `ee/app/models/ee/work_items/type.rb` @ R18.1, `LICENSED_WIDGETS` L18-31 (no Development)
  - `ee/app/models/gitlab_subscriptions/features.rb` @ RM, `PREMIUM_FEATURES_WITH_USAGE_PING` L337-351 (`feature_flags_related_issues` L347)
  - `ee/app/policies/ee/project_policy.rb` @ RM L209-211, L505-507
- **C13** `lib/gitlab/graphql/limit/field_call_count.rb` @ RM L7-11, L35-37; `lib/gitlab/graphql/errors.rb` @ RM L6, L26.
- **C14** `app/graphql/resolvers/concerns/work_items/look_ahead_preloads.rb` @ RM L36-37, L57-58.
- **C15** Visibility:
  - `app/models/ability.rb` @ RM L69-75, L184-190
  - `app/policies/base_policy.rb` @ RM L95-96 (`read_cross_project` denied under external authorization)
  - `app/models/concerns/featurable.rb` @ RM L26-29
- **C16** `app/graphql/types/merge_request_type.rb` @ RM: `authorize :read_merge_request` L13, `draft` L62-63, `state` L86-88, `title` L98-100, `web_url` L194-196, `author` L223-224, `reference(full:)` L272-276. `app/models/project.rb` @ RM `to_reference_base` L2157-2163 and L4076-4099 (no project prefix when `full: false` and there is no Context).
- **C17** `app/services/system_notes/issuables_service.rb` @ RM `cross_reference` L221-261 ("mentioned in #1 / !2 / 54f7727c", `action: 'cross_reference'`).
- **C18** GitLab's Work Item UI @ RM:
  - `app/assets/javascripts/work_items/graphql/work_item_development.fragment.graphql` L3-27
  - `ee/app/assets/javascripts/work_items/graphql/work_item_development.fragment.graphql`, which adds `featureFlags`
  - `app/assets/javascripts/work_items/graphql/merge_request.fragment.graphql`
  - `app/assets/javascripts/work_items/components/work_item_development/work_item_development_relationship_list.vue` L54-69 (`unionBy(…, 'id')`, grouped by state)
- **C19** REST:
  - `lib/api/issues.rb`: @ R18.1 L453-458, L475-479; @ R18.11 L514-535 (`related_merge_requests`), L537-553 (`closed_by`, `MergeRequestsFinder.new(current_user, project_id: user_project.id)`); @ RM L569-581, L595-602
  - `lib/api/entities/merge_request_basic.rb` @ RM: `author` L44, `draft` L57, `references` L107, `web_url` L111
  - `lib/api/entities/issue_basic.rb` @ R18.11: `closed_by` user L11, `merge_requests_count` L33
- **C20** `lib/api/work_items/closing_merge_requests.rb` @ RM:
  - L8-9: behind the `work_item_rest_api` flag
  - L27-37: the comment says `project_id` "would drop merge requests closing this work item from another project"
  - L67: `:experiment`
  - Added in 19.3 (commit `2a934784`). `config/feature_flags/wip/work_item_rest_api.yml` @ RM is `default_enabled: false`.
- **C21** `explicit_mr_work_item_relations`: `config/feature_flags/wip/…yml` @ R19.4 (`type: wip`, `default_enabled: false`, milestone 19.1); `config/feature_flags/beta/…yml` @ S19.5 and RM (`type: beta`, `default_enabled: true`).
- **C22** Commit history from the GitLab commits API (`/repository/commits?path=…` and `/repository/commits/:sha/refs?type=tag`), each with its first release tag:

  | Commit | Change | First release |
  |---|---|---|
  | `5dc384fd` | Development widget, `featureFlags` | 16.11 |
  | `b3e14f4b` | `closingMergeRequests` rename | 17.1 |
  | `8ea22079` | `willAutoCloseByMergeRequest` | 17.2 |
  | `1e449307` | `WorkItemRelatedBranch` | 17.6 |
  | `15e86c65` | `relatedMergeRequests` placeholder | 17.6 |
  | `86971adc` | `relatedMergeRequests` implemented | 17.7 |
  | `bfb19151` | `count` on `closingMergeRequests` | 17.11 |
  | `746f8c2d` | Complexity 10 | 18.1 |
  | `922a6e08` | Related branches hidden without code access | 18.6 |
  | `71730bd9` | `ai_workflows` scope | 18.9 |
  | `63baa539` | `link_type` column | 19.1 |
  | `6a19cf11` | GraphQL field and mutations for merge request ↔ Work Item associations | 19.2 |
  | `e832a60c` | Persisted `mentioned` rows | 19.3 |
  | `04f44c71` | Explicit related merge requests in related lists | 19.4 |
  | `ba46d070` | `closingMergeRequestsCount` | 19.4 |
  | `9d5a0d24` | `MergeRequestIssue` rename, 2026-10-06 | no release tag yet |

GitLab docs (rendered at `https://docs.gitlab.com/<path without doc/ and .md>/`, not fetched):

- **D1** `doc/api/graphql/_index.md` @ RM: Experiment and feature-flag exemptions L285-292; page size and complexity limits L349-358.
- **D2** `doc/development/graphql_guide/authorization.md` @ RM L25-31: redaction after pagination.
- **D3** `doc/user/project/issues/managing_issues.md` @ RM: closing patterns L335-352; manual links L372-376; "Referenced issues are still displayed" when auto-close is off L448.
- **D4** `doc/user/project/issues/crosslinking_issues.md` @ RM: L88, L101 ("mentioned in merge request !(number)"), L103-107 (branch names).
- **D5** `doc/user/work_items/_index.md` @ RM L237-311: "Work items in merge requests" (history L241-242: `mr_related_work_items`, 18.11, GA 19.0) and "Link work items manually" (history L262-263: `explicit_mr_work_item_relations`, 19.1, enabled in 19.5).
- **D6** `doc/api/issues.md` @ R18.11 L2291-2300 (`related_merge_requests`), L2457-2466 (`closed_by`); @ RM L2299-2308, L2465-2474.
- **D7** `doc/api/rest/_index.md` @ R18.11 L314 (`per_page` default 20, max 100).

GitLab MCP server:

- **M1** @ RM:
  - `app/services/mcp/tools/work_items/get_work_item_service.rb` L35-51 (`include` facets, "empty for group-level work items such as epics"), L71-75 (pagination parameters)
  - `app/services/mcp/tools/work_items/get_work_item_tool.rb` L14-29
  - `app/graphql/queries/mcp/work_items/get_work_item.query.graphql` L153-175 (selects only `relatedMergeRequests { id iid title state draft webUrl createdAt mergedAt author }`)
  - `doc/user/model_context_protocol/mcp_server_tools.md` L1454-1500 (introduced in 19.4; default 20, max 100 at L1482; Epics empty at L1500)
- **M2** @ R18.11: `doc/user/gitlab_duo/model_context_protocol/mcp_server_tools.md` and `app/services/mcp/tools/manager.rb`. No tool returns a Work Item's merge requests; `get_issue` returns the REST Issue with `merge_requests_count` only [C19, P3].

glab (`https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/<path>`):

- **L1** `internal/commands/mr/issues/mr_issues.go` L20-23, L49-51; `docs/source/mr/issues.md` L13-18 (merge request → Issues it closes). A search of the whole v1.123.0 tree finds no caller of client-go's `ListMergeRequestsRelatedToIssue` or `ListMergeRequestsClosingIssue`. Those methods exist in `gitlab-org/api/client-go` v3.18.0 `issues.go` L33, L36, L58-59.
- **L2** `internal/commands/issuable/view/issuable_view.go` L322-327 (JSON output is the REST Issue). client-go v3.18.0 `issues.go` L161 (`merge_requests_count`).

Prior research in this repo (read with `git show <branch>:<path>`):

- **P1** `research/gitlab-work-items-api`: `docs/research/gitlab-work-items-api.md`. Covers the Experiment status of the Work Items API, `namespace.workItem`, and PAT scopes.
- **P2** `research/work-item-list-filters`: `docs/research/work-item-list-filters.md`. Covers list fields, Relay pagination, the default page size of 100, and complexity.
- **P3** `research/gitlab-official-mcp-server`: `docs/research/gitlab-official-mcp-server.md`. Covers MCP availability by version and tier, and authentication.
- **P4** `research/glab-cli-work-items`: `docs/research/glab-cli-work-items.md`. Covers `glab api graphql`, `--paginate`, and exit codes.
