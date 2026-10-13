# Map: GitLab Work Items plugin for Claude Code

Labels: wayfinder:map

## Destination

A build-ready spec, with its architecture decisions locked, for a Claude Code plugin that lets Claude Review, Edit, Comment on (including resolving Threads), and create GitLab Issues, Tasks, and Epics on gitlab.com and self-managed Instances, authenticating with a PAT (`GITLAB_TOKEN`) or an existing `glab` login. Building the plugin is a separate effort that starts from this spec.

## Notes

- Domain: GitLab Work Items and Claude Code plugins. Vocabulary lives in `/GLOSSARY.md`; use its terms.
- Skills every session should consult: `grilling` and `domain-modeling` for grilling tickets; `research` for research tickets; `prototype` for prototype tickets.
- Tracker: local markdown (this directory). Tickets are `issues/NN-<slug>.md`, with `Type:`, `Status:` (open/claimed/resolved), and `Blocked by:` lines.
- Target recent GitLab. The original target was 18.x, but gitlab.com now runs 19.5; the minimum version is open (see [Which GitLab versions must v1 support?](issues/13-gitlab-versions.md)). Degrade gracefully where an Instance's tier lacks a Work Item Type.
- Test Instance: the user has one, without Premium, and can only test against it by hand. Agents cannot reach it; any check against it is a HITL task with a precise checklist.
- Built for a team, but v1 auth is a PAT or a reused `glab` login only.
- Planning only: produce decisions, not plugin code.

## Decisions so far

<!-- one line per resolved ticket: [title](link): gist -->

- [What can the glab CLI do with Work Items, and can a plugin reuse its login?](issues/03-glab-cli-work-items.md): native Work Item commands are thin, so most actions need `glab api graphql`; reusing a login by shelling out to `glab api --hostname` is practical, and glab also ships an experimental MCP server.
- [What can a Claude Code plugin contain, and how is it configured?](issues/04-claude-code-plugin-format.md): a plugin can bundle an MCP server plus skills and commands, take the Instance host and a sensitive token through `userConfig`, and ship from a git marketplace; cloud sessions don't load plugins except via org managed settings or committed repo files.
- [What does GitLab's own MCP server offer for Work Items?](issues/02-gitlab-official-mcp-server.md): built into every Instance, but Premium-only on 18.x and Free from 19.2; it can't resolve Threads or read Linked Items even on 19.x, and it takes OAuth or fine-grained PATs, not legacy PATs or a glab login.

## Not yet specified

- **OAuth**: whether and how the plugin supports OAuth sign-in, beyond PAT and `glab`.
- **Implementation language and runtime**: hangs on the integration architecture.
- **Testing strategy**: how the plugin is tested without Premium, and how much against a fake versus a real Instance.
- **Concurrent Edits**: what happens when a description changed in GitLab since Claude read it.
- **Images and attachments** in descriptions and Comments.
- **Custom fields** (GitLab 18's configurable fields on Work Items).
- **Bulk operations** across many Work Items at once.
- **Token-to-Instance scoping**: `GITLAB_TOKEN` applies to every host in glab, so with more than one Instance configured, a token can reach the wrong one; how the plugin keeps each token on its own Instance.
- **Distribution**: how teams install and update the plugin (marketplace, versioning).

## Out of scope

- **Merge requests**: the destination is Work Items only.
- **Other Work Item Types**: objectives, key results, incidents, test cases, and requirements.
- **Building the plugin**: this map ends at the spec.
