# How does GitLab expose the merge requests associated with a Work Item?

Type: research
Status: resolved
Blocked by: none

## Question

Through the GraphQL Work Items API on GitLab 18.1+ (Free tier especially), which merge requests associated with a Work Item can a client read: merge requests that will close it ("Closes #12"), merge requests that merely mention it, and anything else GitLab links (branches, commits)? For each: the field or widget (for example a development widget), the version and tier it needs, whether it's Experiment or behind a feature flag, what per-merge-request data comes back (reference, title, state including draft, URL), pagination, and whether it works for Issues, Tasks, and Epics alike. Also: whether merge requests in projects the token can't see are hidden, and whether `glab` or GitLab's own MCP server expose the same data.

## Answer

Findings: [Merge requests associated with a Work Item](https://github.com/sigvissec/CC-Gitlab-Plugin/blob/research/associated-merge-requests/docs/research/associated-merge-requests.md) (branch `research/associated-merge-requests`; from GitLab's and glab's source at pinned refs, not run against a real Instance).

- One widget, `WorkItemWidgetDevelopment` (`widgets(onlyTypes: [DEVELOPMENT])`), exposes them on Issues and Tasks. It isn't license-gated, so it works on Free and CE with `read_api`, on every 18.1+ release.
- `closingMergeRequests`: merge requests that will close the Work Item ("Closes #12", or manually linked), in any project and any state. Not Experiment; safe in list queries.
- `relatedMergeRequests`: merge requests that mention it, built at query time from the description and notes. Experiment; only one Work Item per request can resolve it (a second gets an error). It usually includes the closing ones, so de-duplicate by merge request.
- Per merge request: `reference(full: true)` (`group/project!34`), `title`, `state`, `draft`, `webUrl`, `author`. Pages hold up to 100.
- Epics have no Development widget, so nothing comes back for them.
- Merge requests the token can't see are hidden; counts can be higher than what's visible.
- glab has no command for this (but `glab api graphql` can send the queries). GitLab's MCP server returns only the mentioning list, and only from 19.4.
