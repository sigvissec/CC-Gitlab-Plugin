# What safety rails guard writes to GitLab?

Type: grilling
Status: resolved
Blocked by: none

## Question

Every Edit, Comment, Thread resolution, and creation is visible to other people. Does each one show a preview (for example a description diff) and need the user's confirmation before it is sent? Are any writes allowed without confirmation? Is there an undo story, and how does the plugin attribute writes made by Claude? Already decided in [Which GitLab API does the plugin build on?](16-api-foundation.md): the plugin re-reads each Work Item after writing it.

## Answer

Resolved by grilling (term Write added to `/GLOSSARY.md`; Edit now includes Linked Items).

**Scope of Writes**
- A Write is an Edit (including adding or removing a Linked Item), a Comment or reply, resolving a Thread, or creating a Work Item.
- The plugin never deletes anything (Work Items, Comments, Threads). Closing a Work Item is the way to make it go away.
- Editing a posted Comment is not a Write in v1.

**Preview and confirmation**
- Every Write shows a preview and waits for the user's explicit confirmation, enforced by the plugin itself regardless of Claude Code permission settings.
- Only the user can confirm: the plugin must be built so that Claude's own word can't count as a yes. Any change to the proposed text means a new preview and a new confirmation. (Requirement on [How does the plugin talk to GitLab?](10-integration-architecture.md).)
- Every preview starts with the full reference and URL, then:
  - Edit: each changed field as before → after; a description change as a diff.
  - Comment or reply: the full text exactly as it will appear (footer included), the target Thread, and whether it is public or internal.
  - Thread resolution: the start of the Thread's first Comment, who started it, and how many replies it has.
  - Creation: every field plus the description, and whether it is confidential.
- Several Writes proposed together get one preview listing them all, confirmed once; the user can drop any. Each still gets its own checks, they are applied in order, and on the first failure the plugin stops and reports exactly what was and wasn't done.

**Checks before sending**
- Permissions: the plugin checks GitLab's per-Work Item and per-Thread permissions before showing a preview, and says up front when the token can't make the Write.
- Staleness: right before sending an Edit, the plugin checks the Work Item hasn't changed since it was Fetched (by its last-updated time); for a reply or resolution, it checks the Thread hasn't gained new Comments since it was Fetched. If either has changed, it stops and shows the new state instead of writing. A new Comment needs no staleness check.

**After sending**
- The plugin re-reads the Work Item after each Write (decided in [Which GitLab API does the plugin build on?](16-api-foundation.md)) and reports each field that didn't stick, with the value GitLab kept. No automatic retry.
- No undo command. An Edit can be reverted using the "before" values from its preview, as a new Write with its own preview and confirmation. A posted Comment can only be changed or removed by the user in GitLab.

**Visibility and attribution**
- Comments and new Threads are public by default; internal only when the user asks. Replies follow their Thread (internal Threads only take internal replies, per GitLab).
- If the user asks for internal and the token's role can't post internal Comments (Reporter or higher is required), the preview says so and asks the user to post publicly or cancel; it never falls back to public silently.
- New Work Items get normal visibility unless the user asks for confidential.
- Comments, replies, and new Work Items' descriptions carry a short footer such as "_Posted with Claude Code_", on by default and switchable off in settings. Edits carry no marker.
