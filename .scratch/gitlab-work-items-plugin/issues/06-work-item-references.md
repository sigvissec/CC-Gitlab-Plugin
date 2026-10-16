# How does a user refer to a Work Item?

Type: grilling
Status: resolved
Blocked by: none

## Question

Which reference forms must the plugin accept: full URLs, `group/project#123`, `group&epic` style, a bare `#123` resolved against the current git remote's project, or others? How are Tasks and Epics referenced, what happens when a reference is ambiguous or points at a different Instance than the configured one?

## Answer

Resolved by grilling (terms Reference, IID, and Context added to `/GLOSSARY.md`).

**Accepted References**
- Full URLs: `/-/work_items/<iid>`, plus the older `/-/issues/<iid>` and `/groups/…/-/epics/<iid>` forms.
- Full references: `group/project#123` for Issues and Tasks (they share one IID sequence per project), `group&45` for Epics.
- Short references: `#123` and `&45`, resolved against a Context.
- A Comment URL (`…/-/work_items/12#note_456`) Fetches the Work Item with that Comment and its Thread as the focus, so "reply to this" or "resolve this" acts on it. Any other URL anchor is ignored.
- No lookup by title in v1; Claude narrows with a filtered list and confirms with the user.

**Resolving short References**
- Context order: the project or group the conversation is currently about, then the current repo's git remote (if it points at the configured Instance), then ask the user. There is no configured default project. Claude says which Context it used, and passes the full Reference to the plugin, so the plugin itself never guesses.
- `&45` resolves against the group directly containing the Context project, or the Context group itself, as GitLab does.
- Several git remotes: use `origin` if it is on the configured Instance, otherwise the only remote that is; if none or several (none of them `origin`), ask.
- A short Reference inside a Fetched Work Item's description or Comments resolves against that Work Item's own project or group, never the conversation's Context.

**Edge cases**
- A Reference to a different Instance is refused with a message naming both Instances; the plugin never contacts an Instance other than the configured one. URLs are matched against the configured base URL, including any sub-path.
- A Reference that resolves to an unsupported Work Item Type (for example an Incident) is refused with a message naming the type, with no read-only exception.
- A Reference that can't be found reports "not found, or your token can't see it", naming the Instance and full Reference, without claiming which.

**Output**
- The plugin always writes the full reference plus its URL (for example `group/project#123` and its link) in lists, confirmations, and errors.

## Update

Epics are now out of scope (see [Do Epics stay in v1 without a Premium Instance to verify against?](11-epics-in-v1.md)). Epic References (`group&45`, `&45`, and `/epics/` or group `/work_items/` URLs pointing at an Epic) are refused like any unsupported Work Item Type. An Issue's Epic parent, where one exists on a Premium Instance, is still shown by its full reference.
