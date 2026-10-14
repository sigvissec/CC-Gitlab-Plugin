# How is the plugin verified using only what Claude can set up?

Type: grilling
Status: open
Blocked by: 10

## Question

Agents can't reach the user's Instance, the user won't test by hand (see [What does our test Instance actually support?](05-test-instance-checks.md)), and the plugin is a TypeScript MCP server calling `glab api` (see [How does the plugin talk to GitLab?](10-integration-architecture.md)). What does verification consist of: a fake GitLab GraphQL endpoint built from GitLab's published schema at pinned versions (18.1 and current), recorded responses, a real GitLab Instance Claude can run or reach (for example GitLab CE in a container, or a gitlab.com test account the user provides a token for), or a mix? Which behaviours must be covered (staleness and permission checks, silent-drop reporting, confirmation, token precedence), and what stays explicitly unverified?
