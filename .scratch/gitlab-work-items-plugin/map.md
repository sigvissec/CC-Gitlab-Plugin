# Map: GitLab Work Items plugin for Claude Code

Labels: wayfinder:map

## Destination

A build-ready spec, with its architecture decisions locked, for a Claude Code plugin that bridges GitLab Work Items into the session. It Fetches Issues, Tasks, and Epics live from gitlab.com and self-managed Instances, as single items (with Threads, Hierarchy, and Linked Items) or filtered lists (by project or group, state, assignee, label, parent), and lets Claude Edit, Comment on (including replying to and resolving Threads), and create them. Reviewing is Claude reasoning over Fetched data, not a plugin feature. Auth is a PAT (`GITLAB_TOKEN`) or an existing `glab` login. Building the plugin is a separate effort that starts from this spec.

## Notes

- Domain: GitLab Work Items and Claude Code plugins. Vocabulary lives in `/GLOSSARY.md`; use its terms.
- Skills every session should consult: `grilling` and `domain-modeling` for grilling tickets; `research` for research tickets; `prototype` for prototype tickets.
- Tracker: local markdown (this directory). Tickets are `issues/NN-<slug>.md`, with `Type:`, `Status:` (open/claimed/resolved/closed), and `Blocked by:` lines. `closed` means ruled out of scope.
- Minimum GitLab is 18.1 (see [Which GitLab versions must v1 support?](issues/13-gitlab-versions.md)). Degrade gracefully where an Instance's tier lacks a Work Item Type.
- Test Instance: the user has one, without Premium, and can only test against it by hand. Agents cannot reach it; any check against it is a HITL task with a precise checklist.
- Built for a team, but v1 auth is a PAT or a reused `glab` login only.
- Planning only: produce decisions, not plugin code.

## Decisions so far

<!-- one line per resolved ticket: [title](link): gist -->

- [What can GitLab's Work Items API do, and where is it gated?](issues/01-gitlab-work-items-api.md): GraphQL Work Items covers everything on Issues, Tasks, and Epics but is still labelled Experiment; Free covers Issues and Tasks except weight, multiple assignees, and blocking links, and Epics need Premium.
- [What can the glab CLI do with Work Items, and can a plugin reuse its login?](issues/03-glab-cli-work-items.md): native Work Item commands are thin, so most actions need `glab api graphql`; reusing a login by shelling out to `glab api --hostname` is practical, and glab also ships an experimental MCP server.
- [What can a Claude Code plugin contain, and how is it configured?](issues/04-claude-code-plugin-format.md): a plugin can bundle an MCP server plus skills and commands, take the Instance host and a sensitive token through `userConfig`, and ship from a git marketplace; cloud sessions don't load plugins except via org managed settings or committed repo files.
- [What does GitLab's own MCP server offer for Work Items?](issues/02-gitlab-official-mcp-server.md): built into every Instance, but Premium-only on 18.x and Free from 19.2; it can't resolve Threads or read Linked Items even on 19.x, and it takes OAuth or fine-grained PATs, not legacy PATs or a glab login.
- [How can the plugin Fetch filtered lists of Work Items?](issues/14-work-item-list-filters.md): `namespace.workItems` (18.1+) lists any scope with every needed filter on Free, but group lists must send `includeDescendants: true`, "assigned to me" needs a username lookup before 19.2, and most list fields are still Experiment; neither glab nor GitLab's MCP server exposes the full filter set.
- [Which GitLab versions must v1 support?](issues/13-gitlab-versions.md): 18.1 minimum, with a clear stop on older Instances; pending confirmation that the test Instance is 18.1 or later.
- [How do filtered lists behave?](issues/15-list-behaviour.md): group lists always include descendants; 20 items by default, most recently updated first, up to 200 on request; entries are compact summaries, with full detail from a single Fetch.
- [Which GitLab API does the plugin build on?](issues/16-api-foundation.md): GraphQL Work Items only, no REST fallback, with version check and re-read after writes; GitLab's and glab's MCP servers are ruled out.

## Not yet specified

- **OAuth**: whether and how the plugin supports OAuth sign-in, beyond PAT and `glab`.
- **Implementation language and runtime**: hangs on the integration architecture.
- **Testing strategy**: how the plugin is tested without Premium, and how much against a fake versus a real Instance.
- **Concurrent Edits**: what happens when a description changed in GitLab since Claude read it. GitLab's Work Items API has no optimistic locking, so any guard is the plugin's own.
- **Images and attachments** in descriptions and Comments.
- **Custom fields** (GitLab 18's configurable fields on Work Items).
- **Bulk operations** across many Work Items at once.
- **Full-text search** across Work Items, beyond filtered lists.
- **Token-to-Instance scoping**: `GITLAB_TOKEN` applies to every host in glab, so with more than one Instance configured, a token can reach the wrong one; how the plugin keeps each token on its own Instance.
- **Distribution**: how teams install and update the plugin (marketplace, versioning).

## Out of scope

- [What does a Review produce, and where does it go?](issues/07-review-output.md): the plugin is a thin bridge for Fetching and writing; reviewing is Claude reasoning over Fetched data, so there is no Review feature to design.
- **Local mirroring of Work Items**: data is Fetched live and writes go straight back; a local copy would add sync and conflict problems GitLab gives no protection against.
- **Merge requests**: the destination is Work Items only.
- **Other Work Item Types**: objectives, key results, incidents, test cases, and requirements.
- **Building the plugin**: this map ends at the spec.
