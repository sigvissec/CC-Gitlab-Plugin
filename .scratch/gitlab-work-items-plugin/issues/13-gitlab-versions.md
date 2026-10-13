# Which GitLab versions must v1 support?

Type: grilling
Status: resolved
Blocked by: none

## Question

The map targeted 18.x, but gitlab.com already runs 19.5, and what GitLab offers changes a lot between them: GitLab's own MCP server is Premium-only on 18.x and reaches Free in 19.2, and its Work Item tools arrive in 19.4 (see [What does GitLab's own MCP server offer for Work Items?](02-gitlab-official-mcp-server.md)). Given the test Instance's version, what is v1's minimum supported GitLab version, and does it support older Instances by degrading or not at all?

## Answer

Minimum supported GitLab version for v1 is **18.1**, on the assumption that the test Instance is 18.1 or later (to be confirmed by step 1 of [What does our test Instance actually support?](05-test-instance-checks.md); if it is older, reopen this ticket).

- Why 18.1: `namespace.workItems` (one list query for any scope) and parent filtering arrive in 18.1, and Epic Work Items became generally available then (see [How can the plugin Fetch filtered lists of Work Items?](14-work-item-list-filters.md)). Supporting 18.0 would need a second set of queries.
- On an older Instance the plugin stops with a clear message naming the minimum version, rather than half-working.
- Newer-version features (such as the `ME` assignee wildcard in 19.2) are not required; the plugin uses the 18.1-compatible form everywhere.
