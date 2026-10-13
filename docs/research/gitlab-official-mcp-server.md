# GitLab's own MCP server and Work Items

Research for ticket 02, "What does GitLab's own MCP server offer for Work Items?"
Researched 2026-10-13. At that date gitlab.com runs 19.5 code, the newest stable branch is
`19-5-stable-ee`, and the last 18.x release is 18.11. Terms follow `/GLOSSARY.md`. Tool and parameter
names keep GitLab's spelling, so `note` and `discussion` appear in identifiers where this document
otherwise says Comment and Thread.

Bracketed tags such as [S1] point to the Sources list at the end. "Unverified" marks anything not
confirmed against a primary source.

## Answer

- **What it is.** The MCP server is part of GitLab itself. It is a JSON-RPC endpoint at
  `https://<instance>/api/v4/mcp` on every Instance, so there is nothing extra to install [S1][S7].
- **Maturity by version.** 18.3 to 18.5: experiment behind the `mcp_server` and
  `oauth_dynamic_client_registration` feature flags, both off by default. 18.6: beta, flags removed.
  19.5: generally available [S1][S4]. gitlab.com already runs the GA version.
- **Tier on 18.x.** Every 18.4 to 18.11 doc lists **Premium and Ultimate only**. It also needs GitLab Duo
  and "beta and experimental features" turned on: for the Instance on self-managed, for the top-level group
  on gitlab.com. The 18.6 to 18.8 docs also listed a Duo Core, Pro, or Enterprise add-on [S4][S6]. The 18.11 code enforces
  this as an Instance-settings check [S7]. **19.2 moved it to Free**, behind its own "Allow connection to
  GitLab" setting [S1][S14][S15].
- **Free self-managed on 18.x: no.** It is documented as unavailable there. The settings it depends on sit on
  an admin page that returns 404 without a paid license or GitLab credits [S10]. On 19.2 and later it works on
  Free. Fresh 19.5 installs have it on by default, and the upgrade to 19.5 turns it on unless an
  administrator turned it off [S14].
- **Work Item tools on 18.x are thin.** `get_issue` and `create_issue` cover project Issues only (18.4).
  `create_workitem_note` posts a Comment or a reply in a Thread on any Work Item, including Epics (18.7).
  `get_workitem_notes` reads Comments (18.7). There are also `search`, `search_labels` (18.9), and
  `get_saved_view_work_items` (18.11) [S5][S11]. **On 18.x there is no Edit at all, no way to create a Task
  or an Epic, and no Hierarchy or Linked Item tools.**
- **19.x adds most of what the plugin needs:**
  - `save_work_item` (19.4) creates or Edits Issues, Tasks, and Epics: title, description, labels,
    assignees, milestone, state, dates, weight, and parent.
  - `get_work_item` (19.4) reads one Work Item. From 19.5 it can return Threads with their resolved state.
  - `list_work_items` (19.4) lists and filters Work Items.
  - `link_work_items` (19.0) adds Linked Items.
  - `save_note` (19.2) replaces `create_workitem_note`.

  [S2][S13]
- **Still missing on current master:**
  - resolving or unresolving a Thread on a Work Item (only merge requests have this)
  - Editing or deleting a Comment
  - reading Linked Items, or removing one
  - listing a Work Item's children (only a `hasChildren` flag is returned)
  - reading weight (`save_work_item` can set it, but `get_work_item` doesn't return it)

  [S2][S13]
- **Authentication.** The usual path is OAuth 2.0 with dynamic client registration (RFC 7591), which
  issues a token with the `mcp` scope. GitLab rejects legacy PATs and project or group access tokens
  with 403 on every version, even when they have `api` scope. **Fine-grained PATs** that carry the
  "MCP tool: Execute" permission work from **19.2** [S1][S8][S12][S14]. A `glab` login's token can't be
  reused, because glab's OAuth asks for `openid profile read_user write_repository api` and not `mcp`
  [S16]. **On 18.x, neither a PAT nor a `glab` login can reach the MCP server.**
- **Connecting from Claude Code.** Claude Code's native `http` transport is all you need:
  `claude mcp add --transport http GitLab https://<host>/api/v4/mcp`, then authorize through `/mcp`. A
  plugin ships the same entry in `.mcp.json` and can take the host from `${user_config.*}`. `mcp-remote` is
  only for clients without HTTP transport [S1][S18][S19].
- **Other first-party MCP offerings.**
  - **`glab mcp serve`** (glab 1.69.0 and later): experimental, runs over stdio, and uses glab's own login,
    whether that's a PAT or OAuth. It exposes `glab work-items`, `glab issue`, Comment creation, and a raw
    `glab api` passthrough to REST and GraphQL, on any tier [S16].
  - **Orbit MCP** (`/api/v4/orbit/mcp`): a knowledge-graph query endpoint, gitlab.com only, Premium and
    Ultimate, beta. It is not a surface for Editing Work Items [S17].

**Implication for the plugin.** The plan targets 18.x, a Free test Instance, PAT or `glab` authentication,
and Thread resolution. GitLab's MCP server meets none of those on 18.x. On 19.2 and later it covers most
reads, creates, and Edits, but it still can't resolve Threads, read Linked Items, or Edit Comments. Any
architecture built on it therefore also needs a direct API path, through REST or GraphQL or through
`glab api`. This is an inference from the findings above, not a GitLab statement.

## Availability by version and tier

| GitLab | Status | Documented tier | Gate on self-managed | Gate on gitlab.com | Source |
|---|---|---|---|---|---|
| 18.3 | Experiment | Free, Premium, Ultimate | Feature flags `mcp_server` and `oauth_dynamic_client_generation` (later spelled `oauth_dynamic_client_registration`), off by default | Same flags | [S6] (18-3-stable-ee) |
| 18.4 to 18.5 | Experiment | Premium, Ultimate | Same flags, off by default | Same flags | [S6] (18-4, 18-5) |
| 18.6 to 18.8 | Beta, flags removed in 18.6 | Premium, Ultimate. "Add-on: GitLab Duo Core, Pro, or Enterprise" | GitLab Duo (Duo Core in the 18.8 wording) and beta and experimental features on | Top-level group with the same settings on | [S4][S6] (18-6, 18-8) |
| 18.9 to 18.11 | Beta | Premium, Ultimate (no add-on line) | GitLab Duo and beta and experimental features on. Code: `duo_features_enabled? && instance_level_ai_beta_features_enabled?` | `current_user.any_group_with_mcp_server_enabled?` | [S4][S6][S7] |
| 19.0 to 19.1 | Beta | Premium, Ultimate | Same as 18.x, unless the `mcp_server_availability_setting` flag is on, in which case the new MCP setting applies | Same as 18.x | [S12][S14] |
| 19.2 to 19.4 | Beta | **Free**, Premium, Ultimate | Instance setting "Allow connection to GitLab" (`mcp_server_enabled`). Flag removed in 19.2 | Top-level group setting. Turned on in 19.2 only for groups that had Duo and beta features on | [S1][S12][S14][S15] |
| 19.5 (current) | **Generally available** | Free, Premium, Ultimate | Same setting, on by default, and turned on at upgrade unless an administrator turned it off | Same group setting, on by default for groups created in 19.5 or later | [S1][S14] |

Notes:

- **Where the 18.x docs lived.** On 18.x the user docs sat at `doc/user/gitlab_duo/model_context_protocol/`,
  rendered at `https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/`. They have since
  moved to `doc/user/model_context_protocol/`, rendered at
  `https://docs.gitlab.com/user/model_context_protocol/mcp_server/` [S1][S4].
- **Gate failures return 404, then 403.** Through 19.4 a failed gate returns `404 Not Found`. From 19.5 it
  returns `403 Forbidden` with a reason such as `MCP server disabled for this instance` [S3][S7].
- **Free self-managed on 18.x.** Most Free self-managed Instances run the EE edition without a license. On
  those, the gate is `duo_features_enabled` together with `instance_level_ai_beta_features_enabled`
  [S7], and three things block it:
  - The admin GitLab Duo page renders 404 unless `License.current&.paid?` or the Instance has GitLab
    credits [S10].
  - The settings API drops `duo_features_enabled` unless `License.ai_features_available?` [S10].
  - The docs list the server as Premium and Ultimate only [S4].

  Treat 18.x Free as unsupported. Two loopholes are unverified: whether an administrator could switch these
  settings on through the API anyway, and how GitLab CE (FOSS) builds behave. In CE code
  `feature_available?` simply returns `true` [S7].
- **Rate limits.** On gitlab.com, a per-user MCP rate limit (Free 60 per minute, Premium and Ultimate 600
  per minute) arrived in 19.5 behind feature flags that are off by default. On self-managed, an
  administrator can set one Instance-wide limit [S1][S3].

## Tools that touch Work Items

### On 18.11, the last 18.x release

Source: the tool registry in `app/services/mcp/tools/manager.rb` (`CUSTOM_TOOLS` and `GRAPHQL_TOOLS`),
plus REST routes tagged `route_setting :mcp` in `lib/api/issues.rb`, `lib/api/search.rb`, and
`lib/api/merge_requests.rb` [S7][S11]. The 18.11 tools doc lists the same tools, except
`get_saved_view_work_items`, which is in the code but not in the 18.11 doc [S5][S11].

| Tool | Since | What it does for Work Items |
|---|---|---|
| `get_issue` | 18.4 | `GET /projects/:id/issues/:issue_iid`. Project-level only, so no Epics. Whether it returns Tasks is unverified. |
| `create_issue` | 18.4 | `POST /projects/:id/issues` with `id`, `title`, `description`, `assignee_ids`, `milestone_id`, `labels`, `confidential`, and `epic_id` (EE). There is no `issue_type`, so it can't create Tasks or Epics. |
| `create_workitem_note` | 18.7 | GraphQL `createNote` on any Work Item, by URL, `project_id`, or `group_id` plus `work_item_iid`. Takes `body`, `internal`, and an optional `discussion_id` to reply in a Thread. Rejects bodies with lines that start with `/`, which would trigger quick actions. |
| `get_workitem_notes` | 18.7 | Paginated Comments with `discussion { id }`. **No resolved or resolvable state.** |
| `search` (`gitlab_search` before 18.8) | 18.4 | Search API over Instance, group, or project. Scope `issues` and others. |
| `search_labels` | 18.9 | Finds labels in a project or group. |
| `get_saved_view_work_items` | 18.11 | Work Items in an existing saved view (needs the saved view's global ID). |

In 18.x nothing Edits a Work Item, and nothing reads or changes Hierarchy or Linked Items. The only
Hierarchy-related input is `epic_id` when you create an Issue.

### On current master (19.5, which gitlab.com runs)

From the tools doc and source [S2][S13]. Tools in the default `work_items` toolset, except where noted:

| Tool | Since | What it does for Work Items |
|---|---|---|
| `get_work_item` | 19.4 | Reads one Work Item of any type, by URL (`/-/work_items/`, `/-/issues/`, `/-/epics/`) or by project or group plus iid. Returns title, description, state, confidential, dates, assignees, labels, milestone, start and due dates, parent with `hasChildren`, and (EE) health status and status. Optional `include` facets: `notes`, `discussions` (19.5, each Thread with `resolvable` and `resolved`), or `related_merge_requests`. |
| `list_work_items` | 19.4 | Lists Work Items in a project or group, including descendants. Filters: state, search, author, assignees, labels, milestone, types, and created, updated, and due dates. EE adds health status and status. **No parent or Hierarchy filter.** |
| `save_work_item` (aliases `create_work_item`, `update_work_item`) | 19.4 | Creates a Work Item when `work_item_iid` is absent, otherwise Edits it. Fields: `type_name` (Issue, Task, Epic, and others the namespace allows), `title`, `description`, `assignee_ids`, `labels` or `label_ids` on create, `add_labels` and `remove_labels` on Edit, `milestone` or `milestone_id`, `confidential`, `start_date`, `due_date`, `state` (`opened` or `closed`), `parent_id`, `weight` and `clear_weight` (Premium and up), `health_status` (Ultimate), `status_id` (Premium and up), and to-do actions. |
| `link_work_items` | 19.0 | Adds Linked Items with `relates_to` (default), `blocks`, or `blocked_by`. The last two need Premium or Ultimate. Up to 10 targets per call. **Add only.** |
| `get_work_item_types` | 19.1 | Lists the Work Item Types in a namespace and the widgets each one supports. |
| `save_note` (aliases `create_workitem_note`, `create_merge_request_note`) | 19.2 | Same behavior as `create_workitem_note`: a Comment or a reply in a Thread. It belongs to the **`core`** toolset, not `work_items`. |
| `get_saved_view_work_items` | 18.11 | As on 18.11. |
| `get_workitem_notes`, `get_issue`, `create_issue` | — | Taken out of `tools/list` in 19.4 in favor of `get_work_item` and `save_work_item`. They can still be called. |
| Supporting tools | 19.4 | `search_labels` (19.5 adds multi-term search), `get_user`, `list_project_members`, `list_projects`, `list_groups`, `search` (scope `work_items`). |

Thread resolution exists only in `save_merge_request_review` with `method: resolve_discussion`, which is
tied to a merge request [S2][S13]. The GraphQL tools run as the authenticated user, with `current_user`
in the schema context [S13], so each call is checked against that user's role in the project or group.

### Coverage against the plugin's needs

| Need (glossary terms) | 18.x (up to 18.11) | Current (19.5) | Gap on current |
|---|---|---|---|
| Read a Work Item (Issue, Task, Epic) for Review | `get_issue` (project Issues, REST shape). No Epic read. | `get_work_item`, any type | Weight, iteration, time tracking, and custom fields are not returned. |
| Read Comments | `get_workitem_notes` (flat list, with Thread id) | `get_work_item` `include: notes` | — |
| Read Threads with resolved state | **Missing** (no resolved flag) | `get_work_item` `include: discussions` (19.5) | — |
| Read Hierarchy: parent | **Missing** (an Issue's epic may appear in the REST payload; unverified) | `get_work_item` returns `parent` | — |
| Read Hierarchy: children | **Missing** | Only the `hasChildren` boolean | **Missing**: no children list and no parent filter in `list_work_items` |
| Read Linked Items | **Missing** | **Missing** | **Missing** |
| List or search Work Items | `search`, `get_saved_view_work_items` | `list_work_items`, `search` | — |
| Create an Issue | `create_issue` | `save_work_item` | — |
| Create a Task (child of an Issue) | **Missing** | `save_work_item` with `type_name: Task` and `parent_id` | — |
| Create an Epic | **Missing** | `save_work_item` with `type_name: Epic` and `group_id` (Premium and up for Epics) | — |
| Edit title or description | **Missing** | `save_work_item` | No optimistic-concurrency guard (no version or `updated_at` check); see "Concurrent Edits" in the map |
| Edit labels, assignees, milestone, state, due date | **Missing** | `save_work_item` | — |
| Edit weight | **Missing** | `save_work_item` (Premium and up) | Weight can't be read back |
| Edit parent | **Missing** | `save_work_item` `parent_id` | Clearing a parent is unverified |
| Add a Linked Item | **Missing** | `link_work_items` | — |
| Remove a Linked Item | **Missing** | **Missing** | **Missing** |
| Post a Comment, internal or public | `create_workitem_note` (18.7) | `save_note` | Lines starting with `/` are rejected |
| Reply in a Thread | `create_workitem_note` with `discussion_id` (18.7) | `save_note` with `discussion_id` | — |
| Edit or delete a Comment | **Missing** | **Missing** | **Missing** |
| Resolve or unresolve a Thread | **Missing** | **Missing** (merge requests only) | **Missing** |

## Authentication

**What the endpoint accepts.**

- On 18.11 the endpoint requires a token whose scopes include `mcp`:
  `allow_access_with_scope :mcp` with `forbidden! unless ... include_any_scope?([Gitlab::Auth::MCP_SCOPE])` [S7].
- From 19.2 it also accepts `Gitlab::Auth::GRANULAR_SCOPE`, which is the fine-grained PAT [S12][S13].
- The current docs list the accepted tokens as:
  - an OAuth access token with the `mcp` scope
  - a fine-grained PAT with the "MCP tool" resource and the Execute permission

  [S1][S14]

**Rejected tokens.** "Legacy personal access tokens, Project access tokens, Group access tokens" can't hold
the `mcp` scope, and the server returns 403 for them "even with scopes such as `api`". Support is only a
proposal (issue 586184) [S1]. In 18.11 code, `Gitlab::Auth#unavailable_ai_features_scopes` removes `mcp` from
the scopes offered to users, projects, and groups [S8]. Fine-grained PATs went beta in 18.10 and GA in 19.2
[S14], but the MCP endpoint only accepts them from 19.2 [S12].

**OAuth with dynamic client registration.**

1. The client discovers metadata at `/.well-known/oauth-protected-resource/api/v4/mcp` and
   `/.well-known/oauth-authorization-server/api/v4/mcp` [S9].
2. It registers at `POST /oauth/register` [S9]. GitLab creates a public application named
   `[Unverified Dynamic Application] <client_name>` with `token_endpoint_auth_method: none`, PKCE required,
   and its scope pinned to `mcp` [S9].
3. The user approves the request in the browser [S1].

Details:

- **Rate limit.** Registration is limited per IP: 5 per hour in the 18.11 source [S9], 10 per hour in the
  current docs [S1].
- **Turning DCR off.** From 19.3, administrators can turn DCR off. Clients then need a pre-registered OAuth
  app with the `mcp` scope and must send its `clientId` [S1][S14]. Creating such an app in the UI arrived in
  19.3 [S1]. Whether you could create an `mcp`-scoped app on 18.x is unverified.

**Reusing a `glab` login.** glab's OAuth flow requests `openid profile read_user write_repository api`
(`internal/oauth2/config.go:23`) [S16]. That token has no `mcp` scope, so the MCP server rejects it. A
legacy PAT stored in glab is rejected too. The only way to reuse a PAT is a fine-grained PAT on 19.2 or
later.

## Connecting from Claude Code and from a plugin

**GitLab's own Claude Code instructions** [S1]:

```shell
claude mcp add -s user --transport http GitLab https://<gitlab.example.com>/api/v4/mcp
# then, inside Claude Code: /mcp, pick GitLab, approve in the browser
```

The 18.x docs give the same command without `-s user` [S4].

**Transport.**

- The recommended transport is HTTP: `"type": "http"`, `"url": "https://<host>/api/v4/mcp"`.
- stdio through `npx mcp-remote <url>` is for clients without HTTP transport and needs Node.js 20 or later.
  Don't pin the `mcp-remote` version [S1].
- The server answers `GET /api/v4/mcp` with 405, so there is no server-to-client SSE stream [S7].

**Request headers.**

| Header | Since | Effect |
|---|---|---|
| `X-Gitlab-Mcp-Server-Tool-Name-Prefix` | 18.11 | Prefixes tool names, truncated to 32 characters. Useful with several Instances [S1][S7]. |
| `X-Gitlab-Enabled-Mcp-Server-Tools` | In 18.11 code | Limits `tools/list` to the named tools [S7]. |
| `X-Gitlab-Enabled-Mcp-Server-Toolsets` | 19.5 | Toolsets: `meta` (always), and by default `core`, `merge_requests`, `work_items`, `repository`, `ci`, and `duo_agent_platform`. Opt-in: `wikis`, `code_security`. GitLab's example value is `core,work_items` [S1][S13]. |

**MCP protocol versions.**

- 18.7 to 18.11 accept `2025-03-26`, `2025-06-18`, and `2025-11-25` [S1][S4][S7].
- Current code also accepts `2026-07-28` in `initialize` and answers with `2025-11-25` [S1][S13].
- Both reject any other `protocolVersion` with an error instead of negotiating down [S7][S13].
- Unverified: which version current Claude Code sends, and whether an 18.x Instance accepts it. Test this
  against a real 18.x Instance.

**Plugin shape, per Claude Code's docs** [S18][S19]:

- A plugin declares MCP servers in `.mcp.json` at the plugin root or under `mcpServers` in `plugin.json`.
- For `http` servers, `${...}` substitution works in `url`, `headers`, and `headersHelper`.
- `userConfig` prompts the user for values. `sensitive: true` keeps a value in secure storage.
- `${user_config.KEY}` is substituted in MCP server config.
- OAuth runs through `/mcp`. Claude Code supports DCR, and it supports pre-registered clients through
  `oauth.clientId` and `oauth.callbackPort`.
- If you configure `headers.Authorization`, Claude Code uses that header and never falls back to OAuth.

A minimal entry for an Instance whose host the user enters:

```json
{
  "mcpServers": {
    "gitlab": {
      "type": "http",
      "url": "https://${user_config.gitlab_host}/api/v4/mcp",
      "headers": {
        "X-Gitlab-Mcp-Server-Tool-Name-Prefix": "gitlab_",
        "X-Gitlab-Enabled-Mcp-Server-Toolsets": "core,work_items"
      }
    }
  }
}
```

- Leave the toolsets header out on 18.x and 19.0 to 19.4, where it doesn't exist [S1].
- **PAT variant, 19.2 and later only.** Add
  `"Authorization": "Bearer ${user_config.gitlab_token}"`, with `gitlab_token` declared `sensitive: true`,
  and give it a fine-grained PAT with MCP tool: Execute.
- **Don't take the token from an environment variable.** Claude Code reads some credential-looking
  variables as empty in remote `url` and `headers`. It also strips credential-like variables from a
  plugin's `headersHelper` environment. A `GITLAB_TOKEN` environment variable is therefore an unreliable
  source [S19]. Whether `GITLAB_TOKEN` is on Claude Code's covered list is unverified.
- Substituting `${user_config.*}` inside a remote `url` is documented in general terms but untested here.

GitLab's docs warn that you are responsible for guarding against prompt injection when you use these tools
[S1].

## Other first-party GitLab MCP offerings

**`glab mcp serve`** [S16]:

- **Status.** Added in commit `1e1d06da` (2025-09-15), first released in glab v1.69.0. Still marked
  "EXPERIMENTAL ... not ready for production use" in v1.123.0.
- **Transport and setup.** stdio only. The documented Claude Code config is
  `{"type": "stdio", "command": "glab", "args": ["mcp", "serve"]}`.
- **Tools.** Each glab subcommand that opts in with an `mcp:*` annotation becomes a tool named
  `glab_<path>`. For Work Items, that includes:
  - `glab work-items` list, create, update, and delete (themselves experimental)
  - `glab issue` create, update, delete, list, view, close, and reopen
  - `glab issue note`, which posts a Comment on an Issue
  - `glab api`, which is destructive-annotated and passes raw REST and GraphQL calls through
- **Implication.** Through `glab_api` it can reach anything the API offers, including Thread resolution
  through REST or GraphQL. It does so with coarse tool schemas and none of the guardrails GitLab's MCP
  server has.
- **Authentication.** Each tool call runs glab as a subprocess, so it uses glab's stored login, PAT or OAuth,
  and works on any tier and version that glab supports.

**Orbit MCP** (`/api/v4/orbit/mcp`, `ee/lib/api/orbit/mcp.rb`) [S17]:

- **What it is.** A separate MCP endpoint for Orbit, GitLab's knowledge graph. It needs an `mcp_orbit` or
  `ai_workflows` token scope and a top-level group with the `orbit` licensed feature.
- **Availability.** The API docs list Orbit as gitlab.com only, Premium and Ultimate, beta in 19.1, and
  turned on for gitlab.com in 19.3.
- **Relevance.** It queries a graph. It doesn't Edit Work Items. Its tool list was not investigated.

**Not MCP servers.** The AI Catalog "MCP servers" feature and the GitLab Duo CLI's MCP connections (GA in
19.2) make GitLab an MCP *client* of other servers [S1][S15]. They are irrelevant here.

## Unverified or not checked

- **Primary pages not fetched.** docs.gitlab.com and about.gitlab.com were blocked by this environment's
  egress proxy. The docs were read from their source in `gitlab-org/gitlab` (`doc/`) at pinned refs, which
  is what docs.gitlab.com renders. GitLab release posts were not read. Version facts come from doc version
  history, stable-branch source, and the release highlights in `data/whats_new/`.
- **Free self-managed loopholes on 18.x.** Whether an administrator of an unlicensed 18.x EE Instance can
  turn the server on by setting `instance_level_ai_beta_features_enabled` (and `duo_features_enabled`)
  through the API. Also how GitLab CE (FOSS) 18.x builds behave, since their code has no gate. Both are
  undocumented and untested.
- **Admin-minted legacy PATs on 18.x.** The 18.11 admin Users API validates PAT scopes against
  `all_available_scopes`, which includes `mcp`. Whether a legacy PAT minted that way with `mcp` would work
  is untested. The docs say legacy PATs are unsupported.
- **Fine-grained PAT permissions.** Whether a fine-grained PAT needs resource permissions beyond MCP tool:
  Execute for the Work Item tools. The source runs GraphQL tools as the user, which suggests not.
- **Edge cases of individual tools.**
  - whether `get_issue` returns Tasks
  - whether `save_work_item` can clear a parent
  - whether 18.x REST Issue payloads include the parent epic
- **Protocol version.** Which MCP protocol version current Claude Code sends, and whether 18.x accepts it.
- **Claude Code substitution.** How `${user_config.*}` behaves in a remote `url`, and whether `GITLAB_TOKEN`
  counts as a covered credential variable.
- **DCR rate limit now.** The current source value was not found. The docs say 10 per hour per IP.
- **Orbit MCP.** Its tool set was not examined.

## Sources

The `gitlab-org/gitlab` refs were read through the public repository API and sparse clones on 2026-10-13.
`master` is pinned at `099d3396543d8905fc820cb3fcc3104ce15f5170`, and `18-11-stable-ee` at
`4b537b4c2227a44f3f9935e783212b1cf927e961`. Other stable branches are cited by name.

- **[S1]** Current MCP server user doc: `doc/user/model_context_protocol/mcp_server.md` @ master,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/099d3396543d8905fc820cb3fcc3104ce15f5170/doc/user/model_context_protocol/mcp_server.md>.
  Rendered at <https://docs.gitlab.com/user/model_context_protocol/mcp_server/> (not fetched).
- **[S2]** Current tools doc: `doc/user/model_context_protocol/mcp_server_tools.md` @ master,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/099d3396543d8905fc820cb3fcc3104ce15f5170/doc/user/model_context_protocol/mcp_server_tools.md>.
  Rendered at <https://docs.gitlab.com/user/model_context_protocol/mcp_server_tools/>.
- **[S3]** Current troubleshooting doc: `doc/user/model_context_protocol/mcp_server_troubleshooting.md` @ master,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/099d3396543d8905fc820cb3fcc3104ce15f5170/doc/user/model_context_protocol/mcp_server_troubleshooting.md>.
- **[S4]** 18.11 MCP server doc: `doc/user/gitlab_duo/model_context_protocol/mcp_server.md` @ 18-11-stable-ee,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/4b537b4c2227a44f3f9935e783212b1cf927e961/doc/user/gitlab_duo/model_context_protocol/mcp_server.md>.
- **[S5]** 18.11 tools doc: `doc/user/gitlab_duo/model_context_protocol/mcp_server_tools.md` @ 18-11-stable-ee,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/4b537b4c2227a44f3f9935e783212b1cf927e961/doc/user/gitlab_duo/model_context_protocol/mcp_server_tools.md>.
- **[S6]** Earlier 18.x MCP server docs, for the tier, add-on, status, and prerequisite lines:
  `doc/user/gitlab_duo/model_context_protocol/mcp_server.md` on `18-3-stable-ee`, `18-4-stable-ee`,
  `18-5-stable-ee`, `18-6-stable-ee`, `18-8-stable-ee`, `18-9-stable-ee`, and `18-10-stable-ee`. For example
  <https://gitlab.com/gitlab-org/gitlab/-/blob/18-3-stable-ee/doc/user/gitlab_duo/model_context_protocol/mcp_server.md>
  and <https://gitlab.com/gitlab-org/gitlab/-/blob/18-6-stable-ee/doc/user/gitlab_duo/model_context_protocol/mcp_server.md>.
- **[S7]** 18.11 MCP endpoint source @ `4b537b4c`:
  - `lib/api/mcp/base.rb`: lines 44 to 50 cover scope and gate, lines 63 and 74 the headers, line 182 the
    405 on GET
  - `ee/lib/ee/api/mcp/base.rb`: lines 24 to 32, the Duo and beta settings gate and the gitlab.com group
    check
  - `app/services/mcp/tools/manager.rb`: lines 39 to 49, the tool registry
  - `lib/api/mcp/handlers/initialize_request.rb`: lines 8 to 23, protocol versions

  Base URL <https://gitlab.com/gitlab-org/gitlab/-/blob/4b537b4c2227a44f3f9935e783212b1cf927e961/lib/api/mcp/base.rb>.
- **[S8]** 18.11 scopes: `lib/gitlab/auth.rb` lines 19 to 31 and 539 to 548 (`unavailable_ai_features_scopes`),
  <https://gitlab.com/gitlab-org/gitlab/-/blob/4b537b4c2227a44f3f9935e783212b1cf927e961/lib/gitlab/auth.rb>.
- **[S9]** 18.11 OAuth discovery and DCR:
  - `app/controllers/oauth/dynamic_registrations_controller.rb`
  - `app/controllers/oauth/protected_resource_metadata_controller.rb`
  - `config/routes.rb` lines 48 to 68
  - `lib/gitlab/application_rate_limiter.rb` line 65

  All @ `4b537b4c`, for example
  <https://gitlab.com/gitlab-org/gitlab/-/blob/4b537b4c2227a44f3f9935e783212b1cf927e961/app/controllers/oauth/dynamic_registrations_controller.rb>.
- **[S10]** 18.11 license gating of Duo settings:
  - `ee/app/controllers/admin/gitlab_duo_controller.rb` lines 23 to 31
  - `ee/lib/ee/api/settings.rb` lines 94 to 96

  Both @ `4b537b4c`,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/4b537b4c2227a44f3f9935e783212b1cf927e961/ee/app/controllers/admin/gitlab_duo_controller.rb>.
- **[S11]** 18.11 Work Item tool source:
  - `app/services/mcp/tools/work_items/` (create and get notes, saved view)
  - `lib/api/issues.rb` lines 291 and 316
  - `lib/api/helpers/issues_helpers.rb` lines 17 to 21
  - `ee/lib/ee/api/helpers/issues_helpers.rb` lines 61 to 63

  All @ `4b537b4c`.
- **[S12]** 19.x endpoint gate and auth: `lib/api/mcp/base.rb` and `ee/lib/ee/api/mcp/base.rb` on
  `19-0-stable-ee` and `19-1-stable-ee` (still only `MCP_SCOPE`, plus the `mcp_server_availability_setting`
  flag) and on `19-2-stable-ee` and `19-3-stable-ee` (adds `GRANULAR_SCOPE` and the `mcp_server_enabled`
  gate). For example
  <https://gitlab.com/gitlab-org/gitlab/-/blob/19-2-stable-ee/lib/api/mcp/base.rb>.
- **[S13]** Current source @ master `099d3396`:
  - `lib/api/mcp/base.rb` lines 69 and 86
  - `ee/lib/ee/api/mcp/base.rb`
  - `lib/api/mcp/handlers/initialize_request.rb` lines 12 to 38
  - `app/graphql/queries/mcp/work_items/get_work_item.query.graphql` lines 80 to 131
  - `ee/app/graphql/queries/mcp/work_items/work_item_edition_widgets.fragment.graphql`
  - `app/services/mcp/tools/work_items/` (`list_work_items_service.rb`, `save_work_item_common.rb`, and the
    others)
  - `app/services/mcp/tools/merge_requests/save_merge_request_review_service.rb` line 17
  - `app/services/mcp/tools/notes/save_note_service.rb` line 10
  - `app/services/mcp/tools/toolsets.rb`
  - `app/services/mcp/tools/base/graphql_tool.rb` lines 68 to 73

  Base URL <https://gitlab.com/gitlab-org/gitlab/-/tree/099d3396543d8905fc820cb3fcc3104ce15f5170/app/services/mcp/tools>.
- **[S14]** Current admin and token docs @ master:
  - `doc/administration/settings/visibility_and_access_controls.md` § "Allow access to the MCP server"
  - `doc/user/group/access_and_permissions.md` § "Allow access to the MCP server"
  - `doc/administration/settings/account_and_limit_settings.md` § "Turn off OAuth dynamic client
    registration"
  - `doc/auth/tokens/fine_grained_access_tokens.md` (beta 18.10, GA 19.2)
  - `doc/auth/tokens/fine_grained_access_tokens_rest.md` § "MCP tool"

  For example
  <https://gitlab.com/gitlab-org/gitlab/-/blob/099d3396543d8905fc820cb3fcc3104ce15f5170/doc/administration/settings/visibility_and_access_controls.md>.
- **[S15]** GitLab release highlights:
  - `data/whats_new/202609170001_19_04.yml` ("New tools in the GitLab MCP server",
    `available_in: [Free, Premium, Ultimate]`, release 19.4)
  - `data/whats_new/202607160001_19_02.yml` (GitLab Duo CLI GA with MCP connections)

  For example <https://gitlab.com/gitlab-org/gitlab/-/blob/master/data/whats_new/202609170001_19_04.yml>.
- **[S16]** glab, `gitlab-org/cli` @ tag `v1.123.0`:
  - `docs/source/mcp/_index.md` and `docs/source/mcp/serve.md`
  - `internal/commands/mcp/serve/server.go`
  - `internal/oauth2/config.go` line 23
  - `internal/commands/workitems/`
  - `internal/commands/api/api.go`
  - `internal/mcpannotations/`
  - introducing commit `1e1d06da4bca9823e08cda3232a3ded042d3e114`, first contained in v1.69.0

  <https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/mcp/serve/server.go>,
  <https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/oauth2/config.go>.
- **[S17]** Orbit: `ee/lib/api/orbit/mcp.rb` @ 18-11-stable-ee and `doc/api/orbit.md` @ master,
  <https://gitlab.com/gitlab-org/gitlab/-/blob/099d3396543d8905fc820cb3fcc3104ce15f5170/doc/api/orbit.md>.
- **[S18]** Claude Code plugin manifest reference (`mcpServers`, `userConfig`, `${user_config.KEY}`, where
  variables resolve), <https://code.claude.com/docs/en/plugins-reference>, fetched 2026-10-13.
- **[S19]** Claude Code MCP docs (plugin-provided servers, OAuth, `oauth.clientId` and `callbackPort`,
  `headersHelper`, environment variable expansion, credential variables that read as empty),
  <https://code.claude.com/docs/en/mcp>, fetched 2026-10-13.
