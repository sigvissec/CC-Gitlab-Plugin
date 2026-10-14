# How do filtered lists behave?

Type: grilling
Status: resolved
Blocked by: 14

## Question

Given [How can the plugin Fetch filtered lists of Work Items?](14-work-item-list-filters.md): does a group list include subgroups and projects, how big is a list and how is it sorted, and what does each entry in a list contain?

## Answer

- **Group scope:** group lists always include subgroups and descendant projects (`includeDescendants: true`), with no way to turn that off in v1. To see only a group's Epics, filter by Work Item Type.
- **Size:** 20 items by default. Claude Fetches further pages only when asked, up to 100 per page and 200 in total per request. Every list says whether more items exist.
- **Sort:** most recently updated first. This is a stable sort, so paging doesn't skip or repeat items.
- **Entry shape:** a compact summary per Work Item: reference, title, Work Item Type, state, assignees, labels, milestone, parent, and last-updated time. Full detail (description, Threads, Hierarchy, Linked Items) comes from Fetching that single Work Item.

## Update

Epics are now out of scope (see [Do Epics stay in v1 without a Premium Instance to verify against?](11-epics-in-v1.md)): lists contain Issues and Tasks only, so filtering a group list down to its Epics no longer applies.
