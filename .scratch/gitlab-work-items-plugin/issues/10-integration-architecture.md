# How does the plugin talk to GitLab?

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 05, 12, 13, 14, 16

## Question

Choose the integration architecture between the two candidates left by [Which GitLab API does the plugin build on?](16-api-foundation.md): (a) a custom MCP server bundled in the plugin that calls GitLab's GraphQL Work Items API, or (b) skills that call `glab api graphql`, or a combination. GitLab's own MCP server and glab's MCP server are ruled out. The choice fixes the implementation language, how auth works for PAT and glab, and how the plugin is packaged. It only has to work on Desktop (see [Must the plugin work in Claude Code on the web, and how does it get there?](12-cloud-session-support.md)). It must also let only the user confirm a Write, so Claude's own word can't count as a yes (see [What safety rails guard writes to GitLab?](08-write-safety.md)).

## Answer

Resolved by grilling, using the Desktop facts recorded on [Must the plugin work in Claude Code on the web, and how does it get there?](12-cloud-session-support.md).

**Architecture**
- **Option (c), combined:** the plugin bundles its own small MCP server, which gives Claude structured tools, and that server reaches GitLab by calling `glab api` (GraphQL) underneath. Every check decided elsewhere (staleness, permissions, re-read, diff previews, footer, merge request ordering) is enforced in the server's code, not left to instructions. The server inherits `glab`'s login handling: keychain storage, token refresh, self-managed hosts and their certificates.
- This matches both the Claude Code norm (a plugin bundling an MCP server) and GitLab's own direction (`glab` and its agent guidance to use `glab api`).
- `glab` is required. `status` checks it's installed and at least the minimum version, pinned when the plugin is built to the oldest `glab` it's tested with.

**Authentication**
- Documented setup paths: (1) log `glab` in (`glab auth login`, with OAuth or a personal access token); (2) a token entered in the plugin's own settings, stored in the system keychain as a sensitive `userConfig` value.
- `GITLAB_TOKEN` works when it actually reaches the plugin (for example in a terminal session) but isn't promised; on macOS the desktop app doesn't pass shell-profile variables on.
- Precedence: the plugin's own setting, then `glab`'s saved login for the configured Instance, then `GITLAB_TOKEN`. Before calling `glab`, the server removes token variables it didn't choose (`GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN`, `OAUTH_TOKEN`) and passes a chosen setting-token to `glab` for that one call only, never saving it into `glab`'s config. `status` names the source in use.
- OAuth is supported only through `glab`'s own login; the plugin has no OAuth flow of its own.

**Confirmation**
- Where the client supports MCP elicitation (documented for the terminal), the server asks the user directly in a dialog.
- Everywhere else, Claude Code's tool-approval prompt is the confirmation, and a hook shipped with the plugin forces that prompt for every Write tool even if the user set it to "always allow".
- A user who deliberately configures Claude Code to auto-answer (for example their own `Elicitation` hook) has made that choice themselves.
- Read tools (Fetch, list, `mine`, `status`) run without prompting: the plugin ships that permission itself if Claude Code allows a plugin to, otherwise setup instructions say to "always allow" them once. Whether a plugin can ship it is a build-time fact to check.

**Implementation and distribution**
- The server is TypeScript, bundled into a single file shipped inside the plugin and run with Node 20 or later; nothing is downloaded at install time.
- This repo, `sigvissec/CC-Gitlab-Plugin`, is its own marketplace: `claude plugin marketplace add sigvissec/CC-Gitlab-Plugin`, then install `gitlab-work-items`. Releases have pinned versions; updates are a deliberate `claude plugin update`.
