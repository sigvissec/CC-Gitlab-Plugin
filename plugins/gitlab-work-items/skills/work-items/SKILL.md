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
3. A short Reference inside a Fetched description or Comment resolves against that Work Item's own project. Fetch such References only when your answer needs them, and say when you do.
4. Show the user the digest the tool returns. Keep the full description and Threads for follow-up questions; Fetch again only when the user wants fresh data.

## Lists

- `list_work_items` lists a project or group (subgroups and projects included); `my_work_items` lists the user's own Work Items across the Instance.
- Turn the user's words into the tools' filters, and say how you read anything ambiguous.
- Lists return 20 by default. Offer more when the result says more exist, continuing with `after` or raising `limit` (200 at most).

## Writes

Every Write follows the same loop, with no exceptions:

1. Call `prepare_writes` with up to 20 Writes. It changes nothing and returns a preview and a plan ID.
2. Show the user the preview exactly as returned.
3. Wait for the user's own explicit yes. If they drop items, note the preview numbers. If they change anything, prepare a new plan.
4. Call `apply_writes` with the plan ID (and `drop` for dropped numbers). The user confirms again in Claude Code's prompt or a dialog; their answer there is final.
5. Report the result, including every field GitLab didn't keep.

Choices inside a Write:

- Post a plain Comment by default; start a Thread (`startThread`) only when the user asks for one.
- Comments are public unless the user asks for internal. If internal is refused for their role, ask whether to post publicly or cancel.
- Reply or resolve with a Comment link as the Reference, or the Thread ID from a Fetch.
- When a Write is refused because the Work Item or Thread changed, show the user what changed before preparing again.
- To undo an Edit, prepare a new Edit back to the "before" values in its preview.

## When something fails

- Relay the tools' messages as they are; they name the Instance and the Reference.
- For setup problems (no token, glab missing, GitLab too old), point the user to `/gitlab-work-items:status`. Tokens go in the plugin's settings or `glab auth login`, which the user does themselves, outside the chat.
