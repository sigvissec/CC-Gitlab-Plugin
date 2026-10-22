---
name: work-items
description: GitLab Work Items (Issues and Tasks) through the gitlab-work-items tools. Use when the user mentions or pastes a GitLab Work Item URL or Reference (group/project#12, #12), asks about their GitLab issues or tasks, wants a list of them, or asks to edit, comment on, reply to, resolve a Thread on, or create one.
---

# GitLab Work Items

The plugin is a thin bridge: its tools Fetch Work Items live from the configured GitLab Instance and carry out Writes. Reviewing a Work Item is your own reasoning over Fetched data.

## Vocabulary

- **Work Item**: an Issue or a Task. Epics and other types are refused by the tools.
- **Reference**: a Work Item URL, or GitLab notation like `group/project#12`. A link to a Comment (`…/-/work_items/12#note_456`) is a Reference that puts that Comment's Thread in focus.
- **Context**: the project or group a short Reference (`#12`) resolves against.
- **Write**: any change in GitLab: an Edit, a Comment or reply, resolving a Thread, creating a Work Item.

## Fetching

1. Fetch every Reference the user gives with `fetch_work_item`, without waiting to be asked.
2. Resolve a short Reference (`#12`) to a full one before calling a tool, using the first Context that applies:
   1. the project or group the conversation is currently about;
   2. the current repo's git remote: `origin` if it's on the configured Instance, otherwise the only remote that is (`git remote -v`);
   3. otherwise ask the user.

   Tell the user which Context you used.
3. Epic References (`group&45`, `&45`) aren't supported: tell the user so instead of resolving or Fetching them.
4. A short Reference inside a Fetched description or Comment resolves against that Work Item's own project. Fetch such References only when your answer needs them, and say when you do.
5. When the user wants the Work Item itself (they ask to open, show, or read it, pick it from a list, or paste its link on its own), show it in full: the digest, the description and every Thread's Comments word for word, then children, Linked Items, and merge requests. When you Fetched it as background for another task, show the digest. Either way, keep the full content for follow-up questions; Fetch again only when the user wants fresh data.

## Lists

- `list_work_items` lists a project or group (subgroups and projects included); `my_work_items` lists the user's own Work Items across the Instance.
- Turn the user's words into the tools' filters, and say how you read anything ambiguous.
- Number the entries and keep each one's Reference, so the user can open one by its number, Reference, or title; then Fetch it and show it in full.
- For the user to choose one in a dialog, call `pick_work_item` with the same filters: it shows them a pick-list and returns the Work Item they pick, which you show in full.
- Offer more when a list says more exist, continuing with `after` or a higher `limit`.

## Wayfinder tickets

- A Wayfinder ticket is a Work Item the wayfinder skill uses for one decision on a Wayfinder map. A wayfinder session claims one by assigning it to the dev working it.
- The user's claimed Wayfinder tickets are the open ones assigned to them: filter with `wayfinderTickets` and `assignedToMe`.
- At session start the plugin shows the user their claimed Wayfinder tickets in the repo's project, numbered; when they name one by its number, Fetch it and show it in full.

## Writes

Every Write follows the same loop, with no exceptions:

1. Call `prepare_writes` with the Writes. It changes nothing and returns a preview and a plan ID.
2. Show the user the preview exactly as returned.
3. Wait for the user's own explicit yes. If they drop items, note the preview numbers. If they change anything, prepare a new plan.
4. Call `apply_writes` with the plan ID (and `drop` for dropped numbers). The user confirms again in Claude Code's prompt or a dialog; their answer there is final.
5. Report the result, including every field GitLab didn't keep.

Choices inside a Write:

- Post a plain Comment by default; start a Thread (`startThread`) only when the user asks for one.
- If a preview flags lines GitLab will run as quick actions, check the user means them; otherwise reword so no line starts with a slash command.
- Comments are public unless the user asks for internal. If internal is refused for their role, ask whether to post publicly or cancel.
- Reply or resolve with a Comment link as the Reference, or the Thread ID from a Fetch.
- When a Write is refused because the Work Item or Thread changed, show the user what changed before preparing again.
- To undo an Edit, prepare a new Edit back to the "before" values in its preview.

## When something fails

- Relay the tools' messages as they are; they name the Instance and the Reference.
- For setup problems (no token, glab missing, GitLab too old), point the user to `/gitlab-work-items:status`. Tokens go in the plugin's settings or `glab auth login`, which the user does themselves, outside the chat.
