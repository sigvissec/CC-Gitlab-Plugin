# Map: GitLab Work Items plugin for Claude Code

Labels: wayfinder:map

## Destination

A build-ready spec, with its architecture decisions locked, for a Claude Code plugin that bridges GitLab Work Items into the session. It Fetches Issues and Tasks live from gitlab.com and self-managed Instances, as single items (with Threads, Hierarchy, and Linked Items) or filtered lists (by project or group, state, assignee, label, parent), shows the merge requests associated with a Work Item (read-only), and lets Claude Edit, Comment on (including replying to and resolving Threads), and create them. Reviewing is Claude reasoning over Fetched data, not a plugin feature. It talks to GitLab through `glab`; auth is an existing `glab` login or a token in the plugin's settings. Building the plugin is a separate effort that starts from this spec.

## Notes

- Domain: GitLab Work Items and Claude Code plugins. Vocabulary lives in `/GLOSSARY.md`; use its terms.
- Skills every session should consult: `grilling` and `domain-modeling` for grilling tickets; `research` for research tickets; `prototype` for prototype tickets.
- Tracker: local markdown (this directory). Tickets are `issues/NN-<slug>.md`, with `Type:`, `Status:` (open/claimed/resolved/closed), and `Blocked by:` lines. `closed` means ruled out of scope.
- Minimum GitLab is 18.1 (see [Which GitLab versions must v1 support?](issues/13-gitlab-versions.md)). Degrade gracefully where an Instance's tier lacks a Work Item Type.
- The user's own Instance (Free, version unconfirmed) can't be reached by agents and isn't used during planning; the user may verify against it after the build. Verification otherwise uses only what Claude can set up itself (see [How is the plugin verified using only what Claude can set up?](issues/18-testing-strategy.md)).
- v1 targets Desktop only (see [Must the plugin work in Claude Code on the web, and how does it get there?](issues/12-cloud-session-support.md)).
- Built for a team, but v1 auth is a `glab` login or a token in the plugin's settings only (see [How does the plugin talk to GitLab?](issues/10-integration-architecture.md)).
- Planning only: produce decisions, not plugin code.

## Decisions so far

<!-- one line per resolved ticket: [title](link): gist -->

- [What can GitLab's Work Items API do, and where is it gated?](issues/01-gitlab-work-items-api.md): GraphQL Work Items covers everything on Issues, Tasks, and Epics but is still labelled Experiment; Free covers Issues and Tasks except weight, multiple assignees, and blocking links, and Epics need Premium.
- [What can the glab CLI do with Work Items, and can a plugin reuse its login?](issues/03-glab-cli-work-items.md): native Work Item commands are thin, so most actions need `glab api graphql`; reusing a login by shelling out to `glab api --hostname` is practical, and glab also ships an experimental MCP server.
- [What can a Claude Code plugin contain, and how is it configured?](issues/04-claude-code-plugin-format.md): a plugin can bundle an MCP server plus skills and commands, take the Instance host and a sensitive token through `userConfig`, and ship from a git marketplace; cloud sessions don't load plugins except via org managed settings or committed repo files.
- [What does GitLab's own MCP server offer for Work Items?](issues/02-gitlab-official-mcp-server.md): built into every Instance, but Premium-only on 18.x and Free from 19.2; it can't resolve Threads or read Linked Items even on 19.x, and it takes OAuth or fine-grained PATs, not legacy PATs or a glab login.
- [How can the plugin Fetch filtered lists of Work Items?](issues/14-work-item-list-filters.md): `namespace.workItems` (18.1+) lists any scope with every needed filter on Free, but group lists must send `includeDescendants: true`, "assigned to me" needs a username lookup before 19.2, and most list fields are still Experiment; neither glab nor GitLab's MCP server exposes the full filter set.
- [Which GitLab versions must v1 support?](issues/13-gitlab-versions.md): 18.1 minimum, with a clear stop on older Instances; the user's own Instance version is unconfirmed.
- [How do filtered lists behave?](issues/15-list-behaviour.md): group lists always include descendants; 20 items by default, most recently updated first, up to 200 on request; entries are compact summaries, with full detail from a single Fetch.
- [Which GitLab API does the plugin build on?](issues/16-api-foundation.md): GraphQL Work Items only, no REST fallback, with version check and re-read after writes; GitLab's and glab's MCP servers are ruled out.
- [How does a user refer to a Work Item?](issues/06-work-item-references.md): URLs (including Comment links), full and short references; short ones resolve against the conversation's Context, then the git remote, then ask; other Instances and unsupported types are refused; output always uses the full reference plus URL.
- [What safety rails guard writes to GitLab?](issues/08-write-safety.md): every Write gets a preview and the user's own confirmation; permission and staleness checks before sending, re-read after; no deletes, no undo command; Comments public by default with a footer.
- [How does GitLab expose the merge requests associated with a Work Item?](issues/17-associated-merge-requests.md): the Development widget lists closing merge requests (stable) and mentioning ones (Experiment, one Work Item per request) on Issues and Tasks, on Free; Epics have none.
- [How do users invoke the plugin?](issues/09-user-facing-surface.md): conversation first, with Commands `fetch`, `list`, `mine`, `comment`, and `status` under `/gitlab-work-items:`; a Fetch shows a digest including associated merge requests labelled closes or mentions.
- [Must the plugin work in Claude Code on the web, and how does it get there?](issues/12-cloud-session-support.md): no; v1 targets Desktop (Claude Code on the user's own machine: desktop app, terminal, or IDE extension), with no special handling in cloud sessions.
- [How does the plugin talk to GitLab?](issues/10-integration-architecture.md): the plugin's own TypeScript MCP server calling `glab api` underneath; setup via `glab` login or a token in plugin settings; confirmation by direct dialog or a forced approval prompt; distributed from this repo as its own marketplace.

## Not yet specified

- **Images and attachments** in descriptions and Comments.
- **Custom fields** (GitLab 18's configurable fields on Work Items).
- **Bulk operations** across many Work Items at once.
- **Full-text search** across Work Items, beyond filtered lists.
- **Several Instances**: v1 talks to one configured Instance, and its token handling keeps the token on that Instance (see [How does the plugin talk to GitLab?](issues/10-integration-architecture.md)); whether people who work across several Instances are supported later, and how.

## Out of scope

- **Claude Code on the web (cloud sessions)**: v1 targets Desktop only, as decided in [Must the plugin work in Claude Code on the web, and how does it get there?](issues/12-cloud-session-support.md).
- **Deleting anything** (Work Items, Comments, Threads) and **editing posted Comments**: ruled out in [What safety rails guard writes to GitLab?](issues/08-write-safety.md); closing a Work Item covers removal, and the user fixes Comments in GitLab.
- [What does a Review produce, and where does it go?](issues/07-review-output.md): the plugin is a thin bridge for Fetching and writing; reviewing is Claude reasoning over Fetched data, so there is no Review feature to design.
- **Local mirroring of Work Items**: data is Fetched live and writes go straight back; a local copy would add sync and conflict problems GitLab gives no protection against.
- **Acting on merge requests** (Fetching, reviewing, or commenting on a merge request itself): the destination is Work Items; only the merge requests associated with a Work Item are shown, read-only, as decided in [How do users invoke the plugin?](issues/09-user-facing-surface.md).
- [Do Epics stay in v1 without a Premium Instance to verify against?](issues/11-epics-in-v1.md): no; Epics need Premium and can't be tested, so v1 supports Issues and Tasks only.
- [What does our test Instance actually support?](issues/05-test-instance-checks.md): the user won't run manual checks; facts only a real Instance could confirm stay unverified.
- **Other Work Item Types**: objectives, key results, incidents, test cases, and requirements.
- **Building the plugin**: this map ends at the spec.
