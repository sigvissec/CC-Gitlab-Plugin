# Spec: `gitlab-work-items`, GitLab Work Items for Claude Code

Status: ready-for-agent

Built from the wayfinding map at [map.md](map.md); each decision below traces to a ticket in [issues/](issues/). Vocabulary follows [`/GLOSSARY.md`](../../GLOSSARY.md).

## Problem Statement

Developers who use Claude Code on their own machines and track their work in GitLab keep leaving the session to deal with Work Items. To ask Claude about an Issue, they open it in the browser, copy its description and Threads into the chat, and then go back to GitLab to change labels, close a Task, answer a Comment, or resolve a Thread. Context gets lost along the way: Claude never sees the Issue's Tasks, its Linked Items, or which merge requests will close it.

Nothing available today fits a team on GitLab Free, especially on a self-managed 18.x Instance:

- Anthropic's existing `gitlab` plugin only points at GitLab's own MCP server, which needs Premium on 18.x, rejects classic personal access tokens and `glab` logins, can't resolve Threads, and lacks the list filters people need.
- `glab`'s built-in Work Item commands can't view a Work Item, read Threads, set labels, state, or parent, or resolve anything.
- `glab`'s own MCP server exposes 217 tools that crowd Claude's context and can hand the stored token to Claude.

And whatever Claude does in GitLab is visible to colleagues, so a careless Edit or Comment is a real cost.

## Solution

A Claude Code plugin named `gitlab-work-items` that brings GitLab Issues and Tasks into the session and lets Claude change them safely.

- The user talks normally ("what's left on acme/app#12?", "relabel those three as `blocked`"), or pastes a Work Item URL, and Claude Fetches what it needs live from the configured Instance: a short digest of the Work Item, its Threads, its Hierarchy, its Linked Items, and the merge requests associated with it.
- Claude can Fetch filtered lists ("my open Issues", "open Issues in acme/app labelled auth mentioning *timeout*") as compact summaries.
- Claude can Edit Work Items, Comment and reply, resolve Threads, and create Issues and Tasks. Every Write is previewed first and only happens when the user themselves confirms it; the plugin checks permissions and whether the data changed since it was Fetched, re-reads after writing, and reports anything GitLab silently dropped.
- Five Commands give shortcuts: `/gitlab-work-items:fetch`, `:list`, `:mine`, `:comment`, and `:status`.
- Reviewing a Work Item is simply Claude reasoning over the Fetched data; the plugin is a thin, safe bridge.
- Setup is either an existing `glab` login or a token entered in the plugin's settings. The plugin works on Desktop on Linux (a terminal, an IDE extension, or the Claude desktop app) against gitlab.com or a self-managed Instance running GitLab 18.1 or later, and is installed from this repo, which is its own marketplace.

## User Stories

### Setup and sign-in

1. As a developer, I want to install the plugin from a marketplace with two commands, so that setup takes a minute rather than an afternoon.
2. As a developer already signed in with `glab`, I want the plugin to use my existing `glab` login, so that I don't create or paste another token.
3. As a developer without `glab` set up, I want to enter a personal access token in the plugin's settings and have Claude Code store it where only I can read it, so that I don't need glab's login. (On Linux, Claude Code keeps sensitive options in `~/.claude/.credentials.json`, owner-only but unencrypted; glab's login uses the desktop keyring where one is available.)
4. As a developer on a self-managed Instance under a sub-path (for example `https://example.com/gitlab`), I want to configure the Instance's full base URL, so that References and API calls resolve correctly.
5. As a developer, I want the plugin to tell me exactly what's missing when it isn't set up (no `glab`, no token, wrong Instance, expired token, GitLab older than 18.1), so that I can fix it without guessing.
6. As a developer, I want Claude never to ask me to paste a token into the chat, so that my token doesn't end up in a transcript.
7. As a developer who exports `GITLAB_TOKEN` in a terminal, I want the plugin to use it when nothing better is configured, so that a terminal-only setup still works.
8. As a developer with a `GITLAB_TOKEN` meant for a different GitLab, I want the plugin to ignore token variables it didn't choose, so that my other token is never sent to the wrong Instance.
9. As a developer, I want `/gitlab-work-items:status` to show which Instance is configured, where the token comes from, which `glab` version is installed, the GitLab version and edition, and who I'm signed in as, so that I can trust what the plugin will do.
10. As a developer, I want `status` to run read-only probes (version, Work Item Types, a list query, the associated merge request data) against my Instance, so that I can check the plugin works there before trusting it.
11. As a developer on GitLab older than 18.1, I want a clear message naming the minimum version, so that I know why the plugin won't work rather than seeing it half-work.
12. As a developer, I want reading tools to run without approval prompts, so that Fetching a Work Item I just pasted doesn't interrupt me.

### Referring to Work Items

13. As a developer, I want to paste a Work Item URL (`/-/work_items/<iid>`, or the older `/-/issues/<iid>`), so that I can point Claude at it the way I'd share it with a colleague.
14. As a developer, I want to write `group/project#123`, so that I can refer to Issues and Tasks in GitLab's own notation.
15. As a developer, I want to write a short `#123` and have Claude resolve it against the project the conversation is about, then the current repo's git remote, and otherwise ask me, so that I don't have to type full paths.
16. As a developer, I want Claude to say which project it used when it resolved a short Reference, so that I can catch a wrong guess.
17. As a developer whose repo has both `origin` and `upstream` remotes, I want `origin` to win if it's on the configured Instance, so that short References follow my usual checkout.
18. As a developer, I want a short `#7` inside a Fetched Work Item's description to resolve against that Work Item's own project, as GitLab does, so that cross-references read correctly.
19. As a developer, I want to paste a link to a specific Comment (`…#note_456`) and have that Comment's Thread become the focus, so that "reply to this" or "resolve this" acts on it.
20. As a developer, I want a Reference to a different Instance refused with a message naming both Instances, so that the plugin never contacts an Instance I didn't configure.
21. As a developer, I want References to Epics, merge requests, Incidents, and other unsupported types refused with a message naming the type, so that I know the plugin's limits.
22. As a developer, I want "not found, or your token can't see it" (with the Instance and full Reference) when a Work Item can't be read, so that I'm not misled about which it is.
23. As a developer, I want every Work Item the plugin mentions shown as its full reference plus URL, so that I can click it or paste it back.

### Fetching one Work Item

24. As a developer, I want a short digest when Claude Fetches a Work Item as background for another task (full reference and URL; title, type, state, assignees, labels, milestone, due date; parent; counts of children and Linked Items; number of Threads and how many are unresolved), so that I see what matters at a glance.
24a. As a developer, I want to see a Work Item in full when I open it, pick it from a list, or paste its link on its own (the digest, then its description and every Thread's Comments word for word), so that I can review it in Claude Code without going to GitLab. (Added after the build, at the user's request.)
25. As a developer, I want Claude to keep the full description and Threads available after a Fetch, so that follow-up questions don't trigger another fetch.
26. As a developer, I want to ask Claude to review a Work Item for clarity, completeness, and gaps, so that I get a second opinion before starting work.
27. As a developer, I want Claude to see the Work Item's Tasks and parent, so that it understands where the work sits.
28. As a developer, I want Claude to see the Work Item's Linked Items, so that it knows what relates to or blocks it.
29. As a developer, I want Claude to read Threads with their resolved state, so that it can tell me what's still being discussed.
30. As a developer, I want the digest to list the merge requests that will close the Work Item and the ones that mention it, each labelled **closes** or **mentions**, so that I can see what's in flight.
31. As a developer, I want each associated merge request shown with its reference (`group/project!34`), title, state (draft, open, merged, closed), and URL, so that I can judge progress without opening GitLab.
32. As a developer, I want at most 10 associated merge requests listed (draft and open first, then merged, then closed) with a count of the rest, so that a busy Work Item doesn't flood the conversation.
33. As a developer, I want to be told when some associated merge requests are hidden from my token, so that a count isn't misleading.
34. As a developer, I want `/gitlab-work-items:fetch <reference>` to Fetch one Work Item and show it in full, so that I have a direct shortcut.

### Fetching lists

35. As a developer, I want `/gitlab-work-items:mine` to list my open Work Items across the Instance, so that I can start my day from one place.
36. As a developer, I want to ask for lists in plain words ("open Issues in acme/app labelled auth"), so that I don't learn a filter syntax.
37. As a developer, I want lists filtered by project or group, state, Work Item Type, assignee (including me), author, label (include, exclude, or any of), milestone, and parent, so that I can find exactly what I need.
38. As a developer, I want to filter lists by text in titles and descriptions ("mentioning *timeout*"), so that I can find a Work Item when I only remember what it was about.
39. As a developer, I want group lists to include all subgroups and projects, so that a group list is never mysteriously empty.
40. As a developer, I want lists to show 20 items by default, most recently updated first, with more fetched only when I ask (up to 200), so that lists don't overwhelm the conversation.
41. As a developer, I want every list to say whether more items exist, so that I know when I'm seeing everything.
42. As a developer, I want each list entry to be a compact summary (reference, title, type, state, assignees, labels, milestone, parent, last updated), numbered so I can open one by its number, so that I can scan many Work Items quickly.
43. As a developer, I want Claude to say how it read an ambiguous list request, so that I can correct it.
44. As a developer, I want to list a Work Item's Tasks with filters, so that I can see, for example, which open Tasks are unassigned.

### Writes: previews and confirmation

45. As a developer, I want every Write previewed before it's sent, so that nothing reaches GitLab without me seeing it.
46. As a developer, I want only my own confirmation to count, never Claude's, so that Claude can't approve its own changes.
47. As a developer using the terminal, I want the confirmation to be a dialog the plugin asks me directly, so that the yes comes from me.
48. As a developer in an app without that dialog, I want Claude Code's approval prompt forced for every Write even if I'd set the tool to "always allow", so that the guarantee holds everywhere.
49. As a developer, I want any change to the proposed text to produce a new preview and a new confirmation, so that I never approve something different from what's sent.
50. As a developer, I want Edits previewed as each changed field before → after, with description changes as a diff, so that I can review exactly what changes.
51. As a developer, I want Comments and replies previewed exactly as they'll appear, including the footer, the target Thread, and whether they're public or internal, so that there are no surprises.
52. As a developer, I want a Thread resolution previewed with the start of its first Comment, who started it, and how many replies it has, so that I resolve the right Thread.
53. As a developer, I want a new Work Item previewed with every field and its description, and whether it's confidential, so that I create it right the first time.
54. As a developer, I want several proposed Writes shown in one preview that I confirm once and can drop items from, so that batch changes are quick but still deliberate.
55. As a developer, I want a shared preview limited to 20 Writes, with a suggestion to split anything bigger, so that a runaway change can't touch dozens of Work Items at once.
56. As a developer, I want Writes applied in order and the batch stopped at the first failure, with a report of exactly what was and wasn't done, so that I never wonder about partial results.

### Writes: what can be changed

57. As a developer, I want Claude to Edit a Work Item's title and description, so that I can tidy them up in conversation.
58. As a developer, I want Claude to change labels, assignees, milestone, due date, weight, and state (close or reopen), so that I can update Work Items without switching windows.
59. As a developer, I want Claude to set or change a Task's parent Issue, so that I can reorganise work.
60. As a developer, I want Claude to add and remove Linked Items, so that relationships stay accurate.
61. As a developer, I want Claude to create Issues, and Tasks under an Issue, so that I can capture work as it comes up.
62. As a developer, I want `/gitlab-work-items:comment <reference> "<text>"` to post my quoted text word for word, so that I can comment exactly as I wrote it.
63. As a developer, I want `/gitlab-work-items:comment <reference> <what to say>` to have Claude draft the Comment from my description, so that I can delegate the wording.
64. As a developer, I want `/gitlab-work-items:comment` with a Comment link to reply in that Comment's Thread, so that I can answer a specific question.
65. As a developer, I want Claude to resolve a Thread when I ask, so that I can close out discussions.
66. As a developer, I want Comments public by default and internal only when I ask, so that the people asking questions can see the answers.
67. As a developer, I want replies to follow their Thread's visibility, so that I don't hide an answer from the person who asked.
68. As a developer whose role can't post internal Comments, I want to be asked whether to post publicly or cancel, so that nothing is silently made public.
69. As a developer, I want Comments, replies, and new Work Items' descriptions to carry a short "_Posted with Claude Code_" footer that I can turn off in settings, so that colleagues know how it was written. A new Work Item created without a description gets a description holding only the footer.

### Writes: safety checks

70. As a developer, I want the plugin to check my token's permissions before showing a preview, so that I'm never asked to confirm something that will fail.
71. As a developer, I want an Edit refused, and the new state shown, if the Work Item changed since Claude Fetched it, so that I never overwrite a colleague's change.
72. As a developer, I want a reply or Thread resolution stopped if the Thread gained new Comments since it was Fetched, so that I don't resolve a Thread someone just replied to.
73. As a developer on Free, I want to be told which fields didn't stick (for example a second assignee) and what value GitLab kept, so that silent drops don't fool me.
74. As a developer, I want GitLab's own error messages reported as they are, so that I can act on them.
75. As a developer, I want to revert an Edit by asking Claude, using the "before" values from its preview, as a new previewed Write, so that mistakes are easy to undo without a special undo feature.
76. As a developer, I want the plugin never to delete anything, so that the worst a mistake can do is reversible.

### Teams and maintenance

77. As a team lead, I want teammates to install the same pinned plugin version, so that everyone sees the same behaviour.
78. As a team lead, I want updates to be a deliberate `claude plugin update`, so that a new release never changes behaviour mid-sprint.
79. As a maintainer, I want the plugin verified against real GitLab Test Instances (EE Free at 18.1 and newest, CE newest), so that releases reflect real GitLab behaviour.
80. As a maintainer, I want fast replay tests on every push that need no GitLab, so that day-to-day changes are checked quickly.
81. As a maintainer, I want a recorded-response mismatch to fail the build, so that GitLab API drift is caught rather than shipped.
82. As a maintainer, I want the README to list behaviours that can only be confirmed in the desktop app or IDE extensions, so that the first person there knows what to watch for.
83. As a user on my own Instance, I want a checklist for verifying Writes by hand in a throwaway project, so that I can confirm the plugin on my setup after installing it.

### Wayfinder tickets (added after the build, at the user's request)

84. As a developer who plans with wayfinder, I want Claude Code to show the Wayfinder tickets I've claimed in the repo's project as soon as a session starts, so that I see what's in flight without asking.
85. As that developer, I want each one on its own numbered line with its wayfinder type and the Wayfinder map it belongs to, so that the list stays short.
86. As that developer, I want Claude to be told the same list, so that "open 2" opens the second one in full.
87. As a developer, I want to pick a Work Item from a list in a dialog with the arrow keys and see it in full, so that I can open one without typing its Reference.
88. As a developer, I want nothing shown and no GitLab call made when I start Claude Code outside a repo on my Instance, so that other work isn't slowed or cluttered.
89. As a developer, I want a one-line note when the plugin couldn't check my Wayfinder tickets, and the session to start anyway, so that a GitLab problem never blocks me.

## Implementation Decisions

### Shape of the plugin

- One Claude Code plugin named `gitlab-work-items`, distributed from this repository, which also serves as its marketplace. Releases carry pinned versions; updates are deliberate.
- It contains: a bundled MCP server; skills (one conversation skill plus the five Commands); a write-guard hook; plugin settings (`userConfig`); and a README.
- Target is Desktop only, on Linux (terminal, IDE extensions, and the desktop app's Linux beta on the user's machine). Claude Code on the web gets no special handling; Windows and macOS aren't supported.
- Supported GitLab: 18.1 or later, gitlab.com or self-managed, CE or EE, any tier; behaviour degrades where a tier lacks a field (weight, multiple assignees, blocking links).
- Supported Work Item Types: Issue and Task only.

### Settings (`userConfig`)

- Instance base URL (required; may include a sub-path; default gitlab.com).
- Personal access token (optional; `sensitive`, so Claude Code keeps it out of the settings files, in `~/.claude/.credentials.json` on Linux).
- Footer on Comments, replies, and new descriptions (on by default).

### The MCP server

- Written in TypeScript, bundled into a single file shipped inside the plugin, run with Node 20 or later. Nothing is downloaded at install time.
- It reaches GitLab only by running `glab api` (GraphQL at `/api/graphql`) against the configured Instance's host. `glab` is required; the server checks it's installed and at least the minimum version, pinned to the oldest `glab` the suites pass with.
- It only ever contacts the configured Instance.

The server is organised as a few deep modules, each with a small interface:

- **GitLab gateway.** Runs one GraphQL request through `glab api` and returns data or a typed error. It owns:
  - Token precedence: plugin setting, then `glab`'s saved login for the configured Instance, then `GITLAB_TOKEN`. Before every call it removes token variables it didn't choose (`GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN`, `OAUTH_TOKEN`) from `glab`'s environment, and passes a setting-token for that call only, never saving it into `glab`'s config.
  - Errors: top-level GraphQL errors, mutation-level `errors` arrays (which `glab` reports with exit code 0), and `glab` failures (missing, not logged in, network) all map to typed errors with GitLab's text preserved.
  - Pagination by cursor, at most 100 nodes per page.
  - Its own GraphQL operation names, so Advanced Search routing never kicks in unexpectedly.
- **Instance probe.** Reads `metadata { version enterprise }` and the signed-in user; refuses below 18.1 with a message naming the minimum; looks up Work Item Type IDs per namespace (matching by name, never hard-coded) and caches them for the session; powers `status`, including its read-only probes.
- **Reference resolver.** Accepts only full References: Work Item URLs (`/-/work_items/<iid>`, `/-/issues/<iid>`, with any `#note_<id>` anchor), and full `group/project#iid` references. URLs are matched against the configured base URL, sub-path included. It refuses other Instances, Epic References (`&iid`, group Work Item URLs pointing at Epics), merge request References, and unsupported Work Item Types, each with a specific message. It resolves to a global Work Item ID via `namespace(fullPath).workItem(iid)`. Short References are never accepted by the server: Claude resolves them to full References first (see Skills).
- **Work Item reader.** One Fetch query returns core fields, the widgets for labels, assignees, milestone, dates, weight (EE only), Hierarchy (parent and children), Linked Items, Threads (`discussions(filter: ONLY_COMMENTS)` with `resolvable`, `resolved`, notes, and per-Thread permissions), `userPermissions`, `updatedAt`, and the Development widget. The digest is built from this. Associated merge requests:
  - `closingMergeRequests` and `relatedMergeRequests` are merged and de-duplicated by merge request, labelled **closes** or **mentions**.
  - Each shows `reference(full: true)`, title, state, draft flag, and URL.
  - At most 10 are shown (draft and open, then merged, then closed) with a count of the rest; hidden ones are reported as hidden.
  - `relatedMergeRequests` is only ever requested for one Work Item per request (GitLab errors on a second); lists never include merge requests.
  - The EE-only schema fields (for example weight) are only selected on EE, decided from the Instance probe.
- **List query.** Uses `namespace(fullPath).workItems`, always with `includeDescendants: true` and types restricted to Issue and Task.
  - Filters: state, type, assignee usernames (including the signed-in user's username for "me", looked up first, since the `ME` wildcard only exists from 19.2), author, labels (include, `not`, `or`), milestone, `parentIds`, and `search` over title and description.
  - Default page of 20, sorted by most recently updated (a stable sort); further pages only on request, up to 100 per page and 200 in total; every list says whether more exist.
  - `mine` uses the signed-in user's open Issues and Tasks across the Instance.
  - Entries are compact summaries: full reference, title, type, state, assignees, labels, milestone, parent, last updated.
- **Write planner and applier.** Turns requested Writes into a plan, previews it, gets confirmation, applies it, and reports.
  - Write kinds: Edit (title, description, labels, assignees, milestone, state, weight, due date, parent, adding or removing Linked Items), Comment, reply, resolve Thread, create Issue, create Task under an Issue. Nothing is ever deleted; posted Comments are never edited.
  - Mutations: `workItemUpdate` with per-widget inputs, `workItemCreate` with the namespace's type ID (and `hierarchyWidget.parentId` for Tasks), `workItemAddLinkedItems` / `workItemRemoveLinkedItems`, `createNote` (Comment, or reply with `discussionId`), `discussionToggleResolve`. Label, milestone, and user IDs are looked up by name first.
  - Before preview: permission check from `userPermissions` and per-Thread permissions; Writes the token can't make are refused up front. Fields unlicensed on the Instance's tier are refused up front rather than failing the whole mutation.
  - Preview content: full reference and URL first, then per kind: Edit as each field before → after with description changes as a diff; Comment or reply as the exact final text (footer included), target Thread, and public or internal; resolution as the start of the Thread's first Comment, its author, and reply count; creation as every field, description, and confidential flag.
  - A plan holds at most 20 Writes; larger requests are refused with a suggestion to split them. The user can drop Writes from the plan before confirming.
  - Plans are bound to their exact content: any change produces a new plan and a new preview.
  - Confirmation: where the client supports MCP elicitation, the applier asks the user directly with the preview. Otherwise the apply tool relies on Claude Code's approval prompt, which the write-guard hook forces every time. (Found while building: Claude Code always declares elicitation, so in practice the user approves the prompt and then confirms the preview in the dialog; where no dialog can render, as in `claude -p`, nothing is applied. The apply tool also carries Claude Code's `anthropic/requiresUserInteraction` tool flag, its documented way to prompt on every call. Run in the terminal, the dialog shows only its message's first three lines, so the message opens on the Writes and the tick box says how many it sends; it waits up to an hour, where the MCP SDK's default gave up after a minute.)
  - Right before sending each Write: staleness check (for an Edit, the Work Item's `updatedAt` must match the Fetched value; for a reply or resolution, the Thread must have gained no new Comments). On a mismatch it stops and returns the new state.
  - Writes apply in order; the batch stops at the first failure and reports exactly what was and wasn't done.
  - After each Write, the Work Item is re-read and every field that didn't stick is reported with the value GitLab kept. No automatic retry.
  - Visibility: new Comments are public unless the user asks for internal; replies follow their Thread; if internal is requested but the role can't post internal Comments (Reporter or higher needed), the user is asked to post publicly or cancel. New Work Items aren't confidential unless asked.
  - Footer "_Posted with Claude Code_" on Comments, replies, and new Work Items' descriptions, when the setting is on. Edits carry no marker.

### Tools the server exposes

- Read tools: Fetch one Work Item, list Work Items, list the user's own Work Items, and status. These run without approval prompts: the plugin ships that permission itself if Claude Code allows a plugin to; otherwise the README tells users to "always allow" them once.
- Write tools are split into a read-only **prepare** step, which validates, checks permissions, and returns the preview and a plan identifier, and a single **apply** step, the only tool that changes anything, which confirms with the user (dialog or forced prompt), runs the staleness checks, applies, and reports.

### Write-guard hook

- A `PreToolUse` hook shipped with the plugin that matches the apply tool and always returns an "ask" decision, so Claude Code's approval prompt appears for every Write even if the user set the tool to "always allow". It returns "allow" for the plugin's read-only tools (`status`, the Fetch and list tools, and the prepare tool, which changes nothing), so reading never prompts; a plugin can't pre-approve tools through its own settings. It says nothing about any other tool.

### Session-start hook (added after the build, at the user's request)

- A `SessionStart` hook, on startup, resume, and `/clear` (not after compaction), with a 30-second limit. It reads the plugin's settings from Claude Code's `CLAUDE_PLUGIN_OPTION_*` variables and reaches GitLab through the same gateway as the server.
- The repo's project: its `origin` remote if that's on the configured Instance, otherwise the one project its other remotes on the Instance point to (HTTPS, `ssh://`, and `git@host:path` remotes; under a sub-path, HTTPS remotes carry it and SSH remotes don't). Outside a git repo, or with no such remote, it shows nothing and calls nothing.
- One query lists the open Issues and Tasks in that project labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` and assigned to the signed-in user (how a wayfinder session claims a ticket), 20 at most with a count of the rest, plus the project's `wayfinder:map` Issues for their titles. A ticket's map is the Issue its `Part of #<map>` line names.
- It shows the user a numbered line per ticket (`systemMessage`) and gives Claude the same list (`additionalContext`), so a number names a ticket. With no claimed tickets it shows nothing; when GitLab can't be reached it shows one line saying why, and always lets the session start.

### Work Item picker (added after the build, at the user's request)

- A read-only `pick_work_item` tool takes `list_work_items`' inputs, shows the list as a single-choice MCP elicitation dialog (a titled `oneOf`, one option per Work Item: its Reference and title), and returns the picked Work Item exactly as `fetch_work_item` does. Dialogs wait up to an hour.
- When nothing matches it says so without a dialog; when the user declines or cancels it says nothing was picked; where the client can't show a dialog it returns the list for Claude to ask from.

### Skills and Commands

- A conversation skill teaches Claude when and how to use the tools:
  - Fetch References the user gives without being asked; don't chase References inside Fetched text unless needed to answer, and say so when it does.
  - Resolve short References to full ones before calling the server: the conversation's Context, then the current repo's git remote (`origin` if it's on the configured Instance, otherwise the only remote that is, otherwise ask), then ask the user. Say which Context was used. `&iid` resolves against the Context project's group.
  - Present digests, lists, previews, and reports as decided above; say how ambiguous list requests were read.
  - Show a Work Item in full when the user wants the Work Item itself (opens it, picks it from a numbered list, or pastes its link on its own); show the digest when it was Fetched as background for another task.
  - Never ask the user to paste a token; point at `status` on setup problems.
  - Writes only ever go through prepare and apply.
- Commands, each a skill under `/gitlab-work-items:`, taking plain words:
  - `fetch <reference>`: Fetch one Work Item and show it in full.
  - `list <what you want>`: a filtered list.
  - `mine`: the user's open Work Items across the Instance.
  - `comment <reference> <what to say>`: quoted text is posted word for word; otherwise Claude drafts it. A Comment link as the Reference makes it a reply in that Thread. Preview and confirmation apply.
  - `status`: configuration, token source, `glab` and GitLab versions, edition, signed-in user, the 18.1 check, and read-only probes.
  - `open [what to pick from]`: pick a Work Item in a dialog and see it in full; with nothing given, from the Wayfinder tickets the user has claimed in the repo's project. (Added after the build.)
- There are no Commands for other Writes; they're asked for in conversation.

## Testing Decisions

### What makes a good test

- Tests exercise external behaviour only: what a client of the MCP server sees, or what Claude Code sees from the hook. They never reach into module internals, so the server can be restructured freely.
- Every test states the user-visible behaviour it protects (a digest field, a refusal message, a preview, a report).

### Seams

- **Seam 1, primary: the MCP server's tool interface.** Tests start the bundled server as a separate process and act as an MCP client: they call the read, prepare, and apply tools, answer elicitation requests themselves (accept, decline, cancel), and assert on the results. GitLab sits behind `glab`, swapped by putting a different `glab` first on the search path:
  - Real `glab` against a **Test Instance**: the full suite, which also records every request and response.
  - A fake `glab` that replays those recordings: fast, needs no GitLab, runs on every push.
  - The server's code has no test-only hooks; the only swap is which `glab` program it finds.
- **Seam 2: the hooks' input and output contracts.** Tests feed the write-guard hook sample tool calls and check that it demands approval for the apply tool and lets everything else through. They start the session-start hook in throwaway git repos, with GitLab behind the same swapped `glab`, and check what it shows the user and tells Claude; the Test Instance suite records it like the tools.
- Skills and Commands are prompt files, checked for structure only (`claude plugin validate --strict`).

### Test Instances

- Throwaway GitLab Instances from GitLab's official container images: `gitlab/gitlab-ee` without a licence (Free tier) at the newest 18.1 patch and at the newest release, and `gitlab/gitlab-ce` at the newest release.
- Each run seeds a throwaway group and project with Issues, Tasks, Threads, Linked Items, labels, milestones, and a merge request that closes an Issue and one that mentions it.
- One script starts a Test Instance, seeds it, runs the suite, and records; it works in GitHub Actions, in a Claude session, or on a laptop.

### Cadence

- Replay tests run in GitHub Actions on every push.
- The Test Instance suite runs on pull requests touching the server or its queries, plus weekly.
- Recordings are re-made whenever a new GitLab version is tested; a mismatch with the recording fails the build.

### Behaviours the suites must cover

- Fetching single Work Items: every digest field, Threads with resolved state, Hierarchy, Linked Items.
- The associated merge request digest: merge and de-duplication, labels, ordering, the 10-item cap, hidden merge requests.
- Lists: descendants included, every filter including text search and "me", the 20-item default, paging to the 200 cap, the "more exist" signal, the summary entry shape.
- Reference resolution: URL forms (including sub-path Instances and Comment anchors), full references, and refusals for other Instances, Epics, merge requests, and unsupported types; "not found, or can't see it".
- The version stop below 18.1 (by faking the version in replays).
- Every kind of Write, against Free (EE without licence) and CE.
- The permission check, the staleness checks for Edits and for replies and resolutions, the 20-Write cap, stopping at the first failure.
- Silent-drop reporting (for example a second assignee on Free) and unlicensed fields refused up front.
- The footer setting, public versus internal Comments, and the "can't post internal" choice.
- Token precedence and the removal of token variables the server didn't choose.
- Confirmation: elicitation accepted, declined, and cancelled; the hook's forced prompt.

### Prior art

- None in this repository yet; these suites establish the pattern.

## Out of Scope

- Epics, and the other Work Item Types (objective, key result, incident, test case, requirement).
- Claude Code on the web (cloud sessions).
- Windows and macOS: the plugin targets Linux (decided after the spec, at the user's request).
- Deleting anything (Work Items, Comments, Threads) and editing posted Comments.
- Acting on merge requests themselves (Fetching, reviewing, or commenting on a merge request).
- A Review feature: reviewing is Claude reasoning over Fetched data.
- Local mirroring of Work Items.
- Images and attachments beyond showing their links as-is (no downloading, no uploading).
- Custom fields.
- Bulk operations beyond a 20-Write shared preview.
- Searching Comments, and Instance-wide Advanced Search.
- Several Instances at once.
- OAuth beyond `glab`'s own login.
- Using GitLab's own MCP server or `glab`'s MCP server as the plugin's foundation.

## Further Notes

- **Decisions made while writing this spec** (not on the map): new Comments are posted as plain Comments (GitLab's default), and a Thread is started only when the user asks to start one; Writes are split into a read-only prepare tool and a single apply tool so that confirmation and the hook have exactly one place to act.
- **Experiment API risk.** GitLab still labels the GraphQL Work Items API, most list fields, `relatedMergeRequests`, and the parent filters as Experiment. The version check, the re-read after Writes, verbatim error reporting, and the Test Instance suite on new GitLab versions are the mitigations.
- **Build-time checks still open:**
  - Whether a Test Instance actually boots in a Claude session (Docker works there and Docker Hub is reachable, but anonymous pulls are rate-limited and no GitLab has been started yet).
  - Whether a plugin can ship the permission that lets its read tools run without prompts.
  - The minimum `glab` version to pin.
- **Unverified on real Instances** (from the planning research, which read GitLab's source rather than a live Instance): whether GitLab accepts a token sent as `Authorization: Bearer`, Work Item Type IDs on a self-managed 18.x Instance, exact silent-drop and unlicensed-field errors on Free, and associated merge request edge cases. The Test Instance suite settles these.
- **Unverifiable by Claude, to list in the README:** whether the desktop app prompts for `userConfig` values, whether the elicitation dialog renders in the desktop app and IDE extensions, and whether a plugin's server gets `PATH` when the desktop app is started from the application launcher.
- **The user's own Instance** (Free, version unconfirmed) wasn't reachable during planning; the user may verify against it after the build, using `status`'s read-only probes and the manual checklist in [What does our test Instance actually support?](issues/05-test-instance-checks.md).
- **Research write-ups** behind these decisions live on unmerged branches: `research/gitlab-work-items-api`, `research/work-item-list-filters`, `research/associated-merge-requests`, `research/gitlab-official-mcp-server`, `research/glab-cli-work-items`, and `research/claude-code-plugin-format`.
