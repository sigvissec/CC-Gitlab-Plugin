# How do users invoke the plugin?

Type: grilling
Status: resolved
Blocked by: none

## Question

The plugin is a thin bridge: it Fetches Work Items (single or filtered lists) and carries out Edits, Comments, Thread replies and resolutions, and creation. Do users drive it through slash commands (for example `/gitlab:fetch <ref>`), skills Claude invokes on its own when a Work Item comes up, plain tools Claude calls, or a mix? Which actions get a dedicated command?

## Answer

Resolved by grilling (term Command added to `/GLOSSARY.md`), using [How does GitLab expose the merge requests associated with a Work Item?](17-associated-merge-requests.md).

**How users drive it**
- Conversation is the main way in: the user talks normally and Claude uses the plugin when Work Items come up. Commands are shortcuts; anything a Command does can also be asked for in conversation.
- Claude Fetches a Reference the user gives without being asked (Fetching only reads). It doesn't chase References found inside Fetched text unless that's needed to answer, and says when it does. Writes never happen on their own; they always go through preview and confirmation.
- The plugin is named `gitlab-work-items` (distinct from Anthropic's existing `gitlab` plugin), so Commands read `/gitlab-work-items:<command>`.

**Commands**
- `/gitlab-work-items:fetch <reference>`: Fetch one Work Item and show its digest.
- `/gitlab-work-items:list <what you want, in words>`: a filtered list.
- `/gitlab-work-items:mine`: the user's open Work Items across the Instance.
- `/gitlab-work-items:comment <reference> <what to say>`: quoted text is posted word for word; a description of what to say is drafted by Claude. Preview and confirmation apply. With a Comment link as the Reference, it replies in that Comment's Thread.
- `/gitlab-work-items:status`: the configured Instance, where the token comes from (plugin setting, `GITLAB_TOKEN`, or `glab`), GitLab version and edition, signed-in user, and whether the 18.1 minimum is met.
- Arguments are plain words, not a filter syntax; Claude maps them to filters and says how it read anything ambiguous.
- No other Write has a Command; Edits, resolutions, and creation are asked for in conversation.

**What a Fetch shows**
- A digest: the full reference and URL; title, Work Item Type, state, assignees, labels, milestone, due date; parent and counts of children and Linked Items; number of Threads and how many are unresolved; and associated merge requests.
- The full content stays available, so follow-ups don't re-Fetch; the plugin re-Fetches only before a Write, for the staleness check.
- Associated merge requests (single Fetch only, never in lists): closing and mentioning merge requests in one de-duplicated list, each labelled **closes** or **mentions**, with reference (`group/project!34`), title, state (draft, open, merged, closed), and URL. Up to 10 shown, ordered draft/open, then merged, then closed, with a count of the rest; hidden merge requests are reported as hidden rather than counted misleadingly.
- Epics have no associated merge requests in GitLab; an Epic's digest says merge requests appear on its child Issues, which Claude can Fetch on request. No roll-up in v1.
- Merge requests themselves are not Fetched, reviewed, or commented on; a merge request link or `!34` Reference is refused like any unsupported type.

**Setup and failures**
- Any use when the plugin isn't set up, or the token fails, reports exactly what's missing or failing (no token, wrong Instance, expired token, GitLab below 18.1) and points to `/gitlab-work-items:status`. Claude never asks the user to paste a token into the chat.

## Update

Epics are now out of scope (see [Do Epics stay in v1 without a Premium Instance to verify against?](11-epics-in-v1.md)), so the Epic digest note no longer applies.
