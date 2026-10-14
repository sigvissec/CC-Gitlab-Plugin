# How is the plugin verified using only what Claude can set up?

Type: grilling
Status: resolved
Blocked by: 10

## Question

Agents can't reach the user's Instance, the user won't test by hand (see [What does our test Instance actually support?](05-test-instance-checks.md)), and the plugin is a TypeScript MCP server calling `glab api` (see [How does the plugin talk to GitLab?](10-integration-architecture.md)). What does verification consist of: a fake GitLab GraphQL endpoint built from GitLab's published schema at pinned versions (18.1 and current), recorded responses, a real GitLab Instance Claude can run or reach (for example GitLab CE in a container, or a gitlab.com test account the user provides a token for), or a mix? Which behaviours must be covered (staleness and permission checks, silent-drop reporting, confirmation, token precedence), and what stays explicitly unverified?

## Answer

Resolved by grilling (term Test Instance added to `/GLOSSARY.md`).

**Source of truth: real GitLab in a container**
- Verification runs against throwaway Test Instances: GitLab's official container images, run by Claude or CI, seeded with a throwaway project, with every Fetch and Write exercised against them. No gitlab.com account, and no fake GitLab built from the schema.
- Images: `gitlab/gitlab-ee` without a licence (Free tier) at the newest 18.1 patch (the supported minimum) and at the newest release, plus `gitlab/gitlab-ce` at the newest release (CE's API lacks EE-only fields, and the user's edition is unknown).
- Responses from the Test Instance suite are recorded and replayed as fast tests that need no GitLab. They're re-recorded whenever a new GitLab version is tested, and a difference from the recording fails the build.

**Where and when**
- Recorded replays run in GitHub Actions on every push.
- The Test Instance suite runs in GitHub Actions on pull requests touching the server or its queries, plus weekly, and with one script in a Claude session or on a laptop.

**What must be covered**
- Fetching single items and lists: descendants, the 20-item default and 200-item cap, the summary entry shape.
- The associated merge request digest.
- Reference resolution, and refusals for other Instances, Epics, merge requests, and unsupported types.
- The version stop below 18.1.
- Every kind of Write; the staleness and permission checks; silent-drop reporting (for example a second assignee on Free); the footer; public versus internal Comments.
- Token precedence, including removing token variables the plugin didn't choose.
- Confirmation: the forced approval prompt for Writes, and the elicitation dialog in the terminal.

**Claude Code side**
- Verified in the terminal: plugin structure (`claude plugin validate`), the MCP server run directly, and terminal behaviour.
- Desktop-app and IDE-only behaviours (whether the token reaches the server, whether the `userConfig` prompt appears, whether the confirmation dialog renders) can't be verified by Claude; the plugin's README lists them as explicitly unverified.

**The user's own Instance**
- The user may verify against their own Instance after the build. To help, `status` also runs read-only probes against the configured Instance (version, Work Item Types, a list query, the associated merge request widget) and reports the results. Verifying Writes there stays manual, in a throwaway project, using the checklist kept on [What does our test Instance actually support?](05-test-instance-checks.md).

**Known facts and open build-time checks**
- This cloud container has Docker (the daemon starts on demand), 15 GB of memory, and 4 CPUs, and can reach Docker Hub (anonymous pulls are rate-limited; the first pull attempt hit the limit). `gitlab/gitlab-ee` images are about 2 GB each. GitLab's own package server is blocked here. Actually booting a Test Instance in a Claude session hasn't been tried yet.
