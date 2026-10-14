# How does GitLab expose the merge requests associated with a Work Item?

Type: research
Status: claimed
Blocked by: none

## Question

Through the GraphQL Work Items API on GitLab 18.1+ (Free tier especially), which merge requests associated with a Work Item can a client read: merge requests that will close it ("Closes #12"), merge requests that merely mention it, and anything else GitLab links (branches, commits)? For each: the field or widget (for example a development widget), the version and tier it needs, whether it's Experiment or behind a feature flag, what per-merge-request data comes back (reference, title, state including draft, URL), pagination, and whether it works for Issues, Tasks, and Epics alike. Also: whether merge requests in projects the token can't see are hidden, and whether `glab` or GitLab's own MCP server expose the same data.
