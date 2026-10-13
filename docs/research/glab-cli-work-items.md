# glab CLI: Work Item support and login reuse

Research for ticket 03 ("What can the glab CLI do with Work Items, and can a plugin reuse its login?").
Researched 2026-10-13 against **glab v1.123.0**, released 2026-10-13 and the latest tag at the time [S1].
On `main` (b3bf6ccb, same day), the `workitems`, `api`, and `issue` command sources match the tag.
Terms follow GLOSSARY.md. glab and the GitLab API call Comments "notes" and Threads "discussions".

Citation keys like [S4] refer to the Sources list at the end. "Verified" means I ran the released v1.123.0 binary
(sha256 checked against the release's `checksums.txt`) against a local mock HTTP server. There was no real GitLab Instance
or token, so nothing was checked against gitlab.com or self-managed GitLab.

## Answer

- **There is a native `glab work-items` command, but it is EXPERIMENTAL and small.** It has `list`, `create`, `update`,
  and `delete`, all backed by GraphQL [S2][S3][S4]. It has no `view`, no Comments, no Threads, no Hierarchy, and no
  Linked Items. `update` can set title, description, assignees, milestone, start/due date, and weight only. `create`
  can set type, title, description, and confidential only, so a Task cannot be given its parent Issue at creation [S3].
- **The older `glab issue` commands use REST and only partly cover Issues.** They are `view`, `create`, `update`,
  `close`, `reopen`, `delete`, `note`, and `list` [S5]. `glab issue note` posts top-level Comments only. Replying in a
  Thread and resolving a Thread are native **only for merge requests** (`glab mr note create --reply`,
  `glab mr note resolve`), not for Issues or Work Items [S6][S7]. glab has no Epic or Task command family.
- **Most of what the plugin needs therefore goes through `glab api`.** That covers a full Review (description, Threads,
  Hierarchy, Linked Items) for every type; Edits of labels, state, and parent; creating a Task under its Issue; Linked
  Items; Comments on Epics; and replying to or resolving Threads. glab's own bundled agent skill says the same about
  threaded replies on issues and Work Items: "The CLI does not wrap threaded replies for these, so you fall back to
  `glab api`" [S8].
- **`glab api graphql` can drive the Work Items GraphQL API.**
  - Every field except `query` and `operationName` becomes a GraphQL variable. `-F` is typed (ints, booleans, JSON
    arrays and objects, `@file`); `-f` sends strings. `--input` takes a complete `{query, variables}` JSON body.
  - `--paginate` follows one connection through a variable that must be named `$endCursor`.
  - A top-level GraphQL `errors` array makes glab exit 1.
  - I verified all of the above against a mock [S9][S10].
  - Limits: it pages only the first `pageInfo` it finds, with no nested pagination. Each page is printed as a separate
    JSON document. `--paginate` cannot be combined with `--input`. Errors inside a mutation payload do not change the
    exit code.
- **glab stores credentials per Instance.** Each host has an entry under `hosts:` in `config.yml`.
  - Location: `~/.config/glab-cli/config.yml` if that legacy file exists, otherwise the platform XDG directory. On
    macOS that is `~/Library/Application Support/glab-cli`; on Windows it is `%LOCALAPPDATA%\glab-cli`.
    `GLAB_CONFIG_DIR` overrides both. The file mode is 0600.
  - Since v1.111.0, `glab auth login` stores the token in the OS keyring by default (macOS Keychain, Windows
    Credential Manager, Linux Secret Service). It falls back to plaintext in `config.yml` when no keyring is available,
    in CI, or with `--insecure-storage` [S11][S12][S13][S14].
- **Token precedence:** `GITLAB_TOKEN`, then `GITLAB_ACCESS_TOKEN`, then `OAUTH_TOKEN`, then the stored per-host token
  (keyring or file), then the CI job token [S11].
  - **Environment variables are not scoped per host.** I verified that `GITLAB_TOKEN` overrides the stored token of
    whichever Instance `--hostname` names. A gitlab.com token in the environment would therefore be sent to a
    self-managed Instance [S10][S15].
  - Host selection order: `--hostname`, then the Git remote of the current directory, then `GITLAB_HOST` (or
    `GITLAB_URI` / `GL_HOST`), then the `host` config key, then `gitlab.com` [S12][S16].
- **The safest way to reuse a login is to shell out to `glab api --hostname <instance> ...`.** The plugin never holds
  the token. glab handles the keyring, OAuth refresh, custom CA certificates, proxy, and subfolder installs [S15][S17].
  - If a raw token is unavoidable (for example in an MCP server with its own HTTP client), use
    `glab config get token --host <instance>`. It prints to stdout and reads the keyring too [S18].
  - Pair it with `glab auth status --hostname <instance> --output json`, which gives the REST and GraphQL endpoints and
    the token source without showing the token [S19].
  - This is fine for personal access tokens. OAuth logins store a short-lived access token next to a **single-use**
    refresh token that glab rotates. The plugin must never use the refresh token itself [S17].
  - Avoid `auth status --show-token`: it writes human-readable text to stderr and rejects `--output json`.
  - Also avoid reading `config.yml` or the keyring directly.
- **glab ships an MCP server: `glab mcp serve` (EXPERIMENTAL, stdio).** It turns every annotated command into a tool,
  217 tools in v1.123.0, including `glab_work-items_*`, `glab_issue_*`, and a generic `glab_api`. Each tool call
  spawns a `glab` subprocess, and responses are capped at 50,000 characters [S20][S21].
  - Caveat (verified): its `glab_auth_status` tool accepts `show_token`. Called with `output: "text"`, it returns the
    stored token, so the token can reach the model's context [S19][S21].
- **Installation:** Homebrew is the officially supported method (`brew install glab`) on macOS, Linux, and Windows
  through WSL. Each release also ships binaries and packages: Linux tar.gz/deb/rpm/apk, macOS tar.gz, and Windows zip
  plus an `.exe` installer. Community-maintained options include WinGet `glab.glab`, Chocolatey, scoop, MacPorts,
  Snap, distro packages, mise, asdf, Nix, and the `gitlab/glab` Docker image. glab officially supports GitLab 16.0 and
  later, so 18.x targets are in range [S22][S23][S1].

## Detail

### 1. Native commands relevant to Work Items

#### `glab work-items` (EXPERIMENTAL)

The release notes date each subcommand: `list` arrived in v1.87.0, `create` and `delete` in v1.94.0, and `update` in
v1.98.1 [S24]. Every subcommand prints "This feature is an experiment and is not ready for production use. It might be
unstable or removed at any time." [S2]. Scope comes from `--group <path>` (needed for Epics) or from `-R` / the current
repository for project-level types. `--group` and `--repo` are mutually exclusive [S3][S25].

| Subcommand | Flags (v1.123.0) | Backend |
|---|---|---|
| `list` (alias `ls`) | `--type` (repeatable, e.g. `epic,issue,task`), `--state opened\|closed\|all`, `--per-page` (max 100, default 20), `--after <cursor>`, `-g/--group`, `-R`, `-F/--output text\|json`, `--jq` | GraphQL `group/project.workItems(types, state, first, after)` [S4] |
| `create` | `-T/--type` (required: epic, incident, issue, key_result, objective, requirement, task, test_case, ticket), `-t/--title` (required when non-interactive), `-d/--description` (`-` opens an editor), `--description-file` (`-` = stdin), `-c/--confidential`, `--attach` (project scope only), `-g`, `-R`, `-F`, `--jq` | client-go `WorkItems.CreateWorkItem` (GraphQL `workItemCreate`) [S3][S26] |
| `update <iid>` | `-t/--title`, `-d/--description`, `--description-file`, `-a/--assignee` (replaces the set), `-m/--milestone` (title or ID), `--startdate`, `--duedate` (YYYY-MM-DD), `-w/--weight`, `--attach`, `-g`, `-R`, `-F`, `--jq` | client-go `WorkItems.UpdateWorkItem` (GraphQL `workItemUpdate`) [S3][S26] |
| `delete <iid>` | `-g`, `-R`, `-F`, `--jq` | client-go `WorkItems.DeleteWorkItem`. Deletes immediately; the source has no confirmation prompt [S27] |

Gaps that matter for this plugin:

- **No `view` at all.** `list` fetches only `iid, title, state, workItemType.name, author.username, webUrl` [S4]. A
  Review cannot get the description, labels, Threads, Hierarchy, or Linked Items from any `work-items` command.
- **`update` lacks labels, state (close/reopen), parent, and confidential.** The client-go library glab uses supports
  `AddLabelIDs`, `RemoveLabelIDs`, `StateEvent`, `ParentID`, `HealthStatus`, `IterationID`, and `Status`, but glab
  exposes none of them as flags [S3][S26].
- **`create` cannot set a parent, labels, assignees, or Linked Items,** even though client-go's `CreateWorkItemOptions`
  has `ParentID`, `LabelIDs`, `AssigneeIDs`, and `LinkedItems` [S3][S26]. A Task created this way has no parent.
  Attaching it to its Issue (GLOSSARY: "always the child of an Issue") needs `glab api graphql`.
- **Type IDs are hard-coded.** `create --type` maps names to fixed global IDs `gid://gitlab/WorkItems::Type/1..9`
  (Issue=1, Task=5, Epic=8) [S28][S26]. glab's own source says the list "will become outdated when work item types
  become customizable". Whether these IDs hold on every self-managed 18.x Instance is **unverified** (a candidate check
  for ticket 05).
- client-go labels its whole Work Items API "Experimental: ... may introduce breaking changes even between minor
  versions" [S26].

#### `glab issue` and `glab incident` (REST v4)

| Command | Relevant flags | Notes |
|---|---|---|
| `issue view <id\|URL>` (alias `show`) | `-c/--comments`, `-s/--system-logs`, `-p/--page`, `-P/--per-page` (default 20), `-F/--output text\|json`, `--jq`, `-w/--web` | Uses REST `ListIssueNotes`. JSON output is the issue plus a flat `Notes` array (one page), not grouped into Threads [S29]. Since v1.100.0 it also accepts project `/-/work_items/<iid>` URLs [S24][S30]. |
| `issue create` (alias `new`) | `-t`, `-d`, `--description-file`, `-l/--label`, `-a/--assignee`, `-m/--milestone`, `--due-date`, `-w/--weight`, `-c/--confidential`, `--epic <id>`, `--linked-issues <iids>`, `--link-type` (default `relates_to`), `--template`, `-y/--yes`, `--no-editor` | REST `CreateIssue`. `--epic` sets REST `epic_id` [S31][S32]. Linked Items can be set only at creation. |
| `issue update <id>` | `-t`, `-d`, `--description-file`, `-l/--label`, `-u/--unlabel`, `-a/--assignee` (`+`/`-`/`!` prefixes), `--unassign`, `-m/--milestone`, `--due-date`, `-w/--weight`, `-c/--confidential`, `-p/--public`, `--lock-discussion`, `--unlock-discussion`, time tracking flags | REST `UpdateIssue`. Has no parent/epic flag [S33]. |
| `issue close` / `reopen` / `delete` / `subscribe` / `unsubscribe` | | REST [S5] |
| `issue note <id>` (alias `comment`) | `-m/--message`, `--attach` | REST `CreateIssueNote`, **top-level Comment only**. Without `-m` it opens `$EDITOR`, which hangs in an agent [S6][S34][S8]. |
| `issue list` | `-t/--issue-type issue\|incident\|test_case` (no `task`), `-e/--epic <iid>` (needs `--group`, no pagination), many filters, `-O/--output json` | REST. `--epic` uses the legacy Epic Issues REST endpoint (`EpicIssues.ListEpicIssues`) and filters client-side [S35]. |
| `incident note` / `view` / ... | same shape as `issue` | shares the "issuable" implementation [S5] |

Whether `glab issue view` or `glab issue note` accept a **Task** IID depends on whether the REST Issues API serves
Tasks. That question belongs to ticket 01 and is **unverified** here. Group-level Epics are out of reach of all `issue`
commands, which are project-scoped.

#### Comments and Threads: what exists natively

- **Merge requests only:** `glab mr note create --reply <discussion-id>`, `mr note resolve <mr> <discussion-id|note-id>`,
  `mr note reopen`, `mr note list`, `mr note update`, `mr note delete` [S7][S36].
- **Issues, incidents, and Work Items:** top-level create only (`issue note`, `incident note`). glab's bundled skill says
  `glab issue note` and `glab incident note` "only post root-level comments". For replies it points to
  `glab api projects/:id/issues/<iid>/discussions/<discussion-id>/notes -F body=@file` [S8]. glab has no command to
  resolve a Thread on an Issue or Work Item. The exact REST or GraphQL call is ticket 01's question.

### 2. Mapping the plugin's actions to glab

| Plugin action (GLOSSARY) | Issue | Task | Epic |
|---|---|---|---|
| **Review**: description, Threads, Hierarchy, Linked Items | `glab api graphql`. `issue view --comments -F json` gives description plus a flat list of Comments, but no Threads, Hierarchy, or Linked Items | `glab api graphql` | `glab api graphql` |
| **Edit** title, description, assignees, milestone, due date, weight | `issue update` or `work-items update` | `work-items update` | `work-items update --group` |
| **Edit** labels | `issue update -l/-u` | `glab api` | `glab api` |
| **Edit** state | `issue close` / `reopen` | `glab api` | `glab api` |
| **Edit** parent | `glab api` | `glab api` | `glab api` |
| **Create** | `issue create` (labels, assignees, Linked Items) or `work-items create --type issue` | `work-items create --type task`, then `glab api` to set the parent; or `glab api` alone | `work-items create --type epic --group` |
| Add a **Comment** | `issue note -m` | `glab api` (whether `issue note` works on a Task is unverified) | `glab api` |
| Reply in, or resolve, a **Thread** | `glab api` | `glab api` | `glab api` |
| **Linked Items** | `issue create --linked-issues` at creation only; otherwise `glab api` | `glab api` | `glab api` |

The table follows from section 1; GraphQL schema details are ticket 01's job. One consequence: a plugin built on glab
would use `glab api graphql` for nearly every read and for most writes. The native commands add little beyond
convenience for simple Issue Edits and Comments.

### 3. `glab api` and `glab api graphql`

Behavior below comes from v1.123.0 source [S9][S37][S38] and the docs [S39], and I checked it with the released binary
against a mock `/api/graphql` endpoint [S10].

- **Endpoint and host.** `glab api graphql` posts to `<scheme>://<api_host>[/<subfolder>]/api/graphql`.
  - The host is `--hostname` if given. Otherwise it is the Git remote of the current directory, then `GITLAB_HOST`,
    then `gitlab.com` [S37][S16].
  - Run from inside a user's repository, an unqualified `glab api` call therefore targets *that repository's* Instance.
    **Always pass `--hostname`.**
  - `--hostname` rejects `host:port`. A port goes in the per-host `api_host` key or `GITLAB_API_HOST`, which is how I
    pointed glab at the mock (verified).
- **Variables.**
  - All fields other than `query` and `operationName` are grouped into `variables` [S38]. Verified: the request body
    was `{"query":..., "variables":{"first":2,"fullPath":"group/sub","types":["TASK","ISSUE"]}}`.
  - `-F` converts `true`, `false`, `null`, integers, and values starting with `[` or `{` to JSON. Verified:
    `-F 'input={"id":"gid://gitlab/WorkItem/1","stateEvent":"CLOSE"}'` arrived as a JSON object, which suits mutation
    `input` arguments.
  - `-F name=@file` reads a file. Verified: Markdown with newlines, backticks, and `$` arrived byte-for-byte, which
    suits description and Comment bodies.
  - `-f` always sends a string. A literal value starting with `@` must use `-f` or go through a file [S39][S8].
- **Full body.**
  - `--input <file|->` sends a ready-made JSON body as `application/json`. Verified with
    `{"query":...,"variables":{...}}`. This is the easiest route for a program, since it avoids shell quoting.
  - glab's bundled skill still says `--input` does not set Content-Type and needs `-H 'Content-Type: application/json'`
    [S8]. v1.123.0's docs and code say otherwise [S39][S37], and the mock confirmed `application/json`. The skill text
    is stale.
- **Pagination.**
  - With `--paginate`, glab re-sends the request with `variables.endCursor` set to the `endCursor` of the **first**
    `pageInfo` object in the response that has both `hasNextPage` and `endCursor`. It stops when `hasNextPage` is false
    [S40][S37].
  - The query must declare `$endCursor: String` under exactly that name.
  - Only one connection is followed. Nested connections, such as notes inside discussions or children in the
    Hierarchy widget, are not paginated (inferred from [S40]).
  - Output is one JSON document per page. In the default `json` mode the documents are concatenated with no separator
    (`}{`), which `jq -s` or a streaming decoder can split. `--output ndjson` gives one page per line. glab does not
    merge pages (verified).
  - `--paginate` and `--input` are mutually exclusive (verified: the flag-group error).
- **Errors and exit codes.**
  - A response whose top-level body has `errors` (or `message`) is still printed to stdout. The error text goes to
    stderr as `glab: <message>`, and glab exits 1 (verified with an `errors` array in a 200 response) [S37][S41].
  - HTTP status 300 or higher also exits 1, with `glab: HTTP <code>` [S37].
  - Mutation payload errors such as `workItemUpdate { errors }` live inside `data`, so the exit code stays 0 and the
    caller has to check them (inferred from `parseErrorResponse`, which reads only top-level keys [S37]).
- **Auth header.** A PAT is sent as `Private-Token` (verified). OAuth logins use a refreshing token source [S15].
- **Verdict.** This is enough to drive Work Items GraphQL: queries with variables, single-connection pagination, and
  mutations with object inputs. Nested pagination (all Comments in all Threads, or all Hierarchy children) needs the
  caller to loop over cursors itself.

### 4. Credential storage and per-Instance hosts

**Config file** [S12][S42]:

- Search order:
  1. `$GLAB_CONFIG_DIR/config.yml`
  2. `~/.config/glab-cli/config.yml` (legacy location, checked first on every OS)
  3. `$XDG_CONFIG_HOME/glab-cli/config.yml`. On Linux that is `~/.config/glab-cli/config.yml`; on macOS
     `~/Library/Application Support/glab-cli/config.yml`; on Windows `%LOCALAPPDATA%\glab-cli\config.yml`.
  4. `$XDG_CONFIG_DIRS/glab-cli/config.yml` (system-wide)
- Per-repository overrides go in `.git/glab-cli/config.yml`.
- `glab config path [--dir]` prints the active path.
- The file is written with mode 0600 (verified).
- Format: YAML. Global keys sit at the top level. Each Instance has a map under `hosts:`. Verified excerpt after
  `glab config set token ... --host gitlab.example.com`:

  ```yaml
  hosts:
      gitlab.com:
          api_protocol: https
          api_host: gitlab.com
          token:
          use_keyring:
          ...
      gitlab.example.com:
          token: glpat-FAKE-selfmanaged
  ```

- Per-host keys include `token`, `job_token`, `api_host`, `api_protocol`, `subfolder`, `ssh_host`, `client_id`,
  `use_keyring`, `proxy`, `ca_cert`, `client_cert`, `client_key`, `skip_tls_verify`, and `custom_headers` [S13]. OAuth
  logins also write `is_oauth2`, `oauth2_refresh_token`, and `oauth2_expiry_date`, which the CLI manages itself [S13].

**Keyring** [S11][S14][S43]:

- Since v1.111.0 ("store credentials in OS keyring by default"), `glab auth login` probes for a working keyring. If one
  is present it sets `use_keyring: true` for the host and stores the secret there instead of in the file [S24][S14].
- The library is `zalando/go-keyring` v0.2.8 [S44]. Entries use the service name `glab:<host>:token` (and
  `glab:<host>:oauth2_refresh_token`) with an empty user. The legacy name `glab:<host>` is still read [S43].
- glab falls back to plaintext when no keyring exists, when `GITLAB_CI` or `CI` is true, or with `--insecure-storage`.
  On Snap, the keyring needs `sudo snap connect glab:password-manager-service` [S11][S23].
- A locked or denied keyring makes token reads fail with an error rather than return an empty token [S43].
- **Not tested** (the sandbox has no Secret Service): the keyring path itself, and whether another program could read
  these entries directly.

**Environment variables and precedence** [S11][S12][S13][S45]:

- Token: `GITLAB_TOKEN`, then `GITLAB_ACCESS_TOKEN`, then `OAUTH_TOKEN`, then stored credentials (keyring or file),
  then the CI job token (only with `GLAB_ENABLE_CI_AUTOLOGIN=true` and `GITLAB_CI=true`).
- In the config layer, any matching environment variable wins before the host is even looked at [S45]. So it is **not
  host-scoped**.
  - Verified: with a stored `glpat-STORED-for-mock` for `gitlab.mock.test`, setting `GITLAB_TOKEN=glpat-ENV-token`
    made glab send the env token to that host.
  - Verified: `glab config get token --host gitlab.example.com` printed the env value.
- Host: `GITLAB_HOST`, then `GITLAB_URI`, then `GL_HOST`, which feed the `host` key (default `gitlab.com`).
  - `GITLAB_API_HOST`, `GLAB_API_PROTOCOL`, `GITLAB_SUBFOLDER`, `GLAB_CA_CERT`, and `GLAB_PROXY` override the matching
    per-host keys, for every host.
  - glab's docs warn: "Environment variables are not scoped per host ... if you work with more than one GitLab
    instance, use the configuration file instead." [S12]
- Self-managed setup: `glab auth login --hostname <host> --stdin < token.txt` for a PAT. OAuth needs
  `glab config set client_id <id> --host <host>` first, using a non-confidential application with redirect
  `http://localhost:7171/auth/redirect` and scopes `openid profile read_user write_repository api`. The `--device`
  flow needs GitLab 17.9 or later [S11][S46].

### 5. Reusing an existing `glab auth login` from a skill or MCP server

| Approach | Works for | Safety and caveats |
|---|---|---|
| **A. Shell out to `glab api --hostname <host> [graphql] ...`** (recommended) | gitlab.com and self-managed; PAT and OAuth | The plugin never sees the token. glab resolves env, keyring, or file; refreshes OAuth and writes the rotated token back; applies `ca_cert`, `proxy`, `subfolder`, `api_host`, and `custom_headers` [S15][S17]. Costs: one process per call; glab must be installed; JSON on stdout and errors on stderr with exit 1. In the **Claude Code sandbox**, glab cannot save refreshed OAuth credentials. glab's docs offer two fixes: add `glab` to `sandbox.excludedCommands`, or allow writes to `glab config path --dir` (and, on macOS, `~/Library/Keychains/login.keychain-db*`) [S11]. |
| **B. Read the token once: `glab config get token --host <host>`** | PAT logins; OAuth only until the access token expires | Prints to stdout and reads the keyring as well [S18]. Use `glab auth status --hostname <host> --output json` for `api_endpoint`, `graphql_endpoint`, `token_source` (`keyring`, `config_file`, or `environment`), and `state`, without printing the token (verified) [S19]. For OAuth hosts (`is_oauth2: true`), the stored access token expires. glab refreshes it with a 5-minute grace period and writes the result back. Refresh tokens are single-use, so a plugin that refreshed on its own would break glab's session [S17]. A long-lived MCP server would have to re-run A (any `glab api ... user` call refreshes) and then re-read B before expiry. Watch for a host-agnostic `GITLAB_TOKEN` (check `token_source`). |
| C. `glab auth status --show-token` | none (avoid) | Writes human-readable text to **stderr**, refuses `--output json`, and reads the token *before* the API call that might refresh it [S19]. Verified. |
| D. Parse `config.yml` or query the keyring directly | none (avoid) | The token may sit in the keyring (`use_keyring: true`) or only in an env var. Keyring item names and legacy names are glab internals [S43]. |

Practical rules either way:

- Always name the Instance with `--hostname` or `--host`.
- Detect an injected env token through `token_source`.
- Never pass the token on a command line; glab's own docs discourage `--token` in shared environments [S11].
- If the plugin's own PAT mode wants to reuse glab as the HTTP client, it can set `GITLAB_TOKEN` (and `GITLAB_HOST`) in
  the environment of a single glab subprocess. This works because env tokens override stored ones, but it applies to
  whatever host that call targets (inferred from [S45]).

### 6. MCP server mode: `glab mcp serve`

- EXPERIMENTAL; stdio transport. The docs show the Claude Code config
  `{"type":"stdio","command":"glab","args":["mcp","serve"]}` [S20].
- Tools are generated from Cobra commands. A command is registered only if it carries an MCP annotation (`safe` or
  `destructive`) and is not marked `interactive` or `exclude`. Tool names are `glab_<path joined by _>` [S21][S47].
- Each tool call runs the same glab binary as a subprocess with the inherited environment. Output is capped at 50,000
  characters, and since v1.86.0 the server auto-enables JSON output [S21][S24].
- Verified with the v1.123.0 binary: 217 tools, among them `glab_work-items_list` (read-only), `glab_work-items_create`,
  `glab_work-items_update`, and `glab_work-items_delete` (destructive), `glab_issue_view`, `glab_issue_note`,
  `glab_incident_note`, `glab_mr_note_resolve`, and `glab_api` (destructive, generic). Tool inputs are a generic
  `{args: [...], flags: {...}}` object.
- `glab config get` is excluded (`mcp:exclude`) [S18].
- **Caveat (verified):** `glab_auth_status` accepts `flags.show_token`. With `output: "text"` the tool result contains
  the stored token, so the model can read it.
- Fit for this plugin: it gives Work Item list/create/update/delete and a generic API tool, so in practice it would be
  `glab_api` plus coarse wrappers. It would add no Work Item Review or Thread support beyond what `glab api` already
  provides. Ticket 02 covers GitLab's separate official MCP server.

### 7. Installation

From the README and `docs/installation_options.md` at v1.123.0 [S22][S23], and the v1.123.0 release assets [S1]:

- **Official:** Homebrew, `brew install glab` / `brew upgrade glab`, on macOS, Linux, and Windows via WSL. Release
  binaries are on the releases page. Building from source uses `make build` / `make install`, with the Go version from
  `go.mod` (Go 1.27.2 at v1.123.0).
- **v1.123.0 release assets:** `linux_{amd64,arm64,386,armv6,ppc64le,s390x}`, each as `.tar.gz`, `.deb`, `.rpm`, and
  `.apk`; `darwin_{amd64,arm64}.tar.gz`; `windows_{amd64,arm64,386}.zip`;
  `Windows_{x86_64,arm64}_installer.exe`; FreeBSD tarballs; and `checksums.txt`.
- **Community (not officially supported):**
  - macOS: MacPorts, mise, asdf.
  - Windows: WinGet `winget install glab.glab`, Chocolatey `choco install glab`, scoop `scoop install glab`, mise,
    asdf (WSL).
  - Linux: Snap (`sudo snap install glab`, plus `snap connect glab:password-manager-service` for the keyring), Arch
    `pacman -S glab`, Alpine `apk add glab`, Fedora `dnf install glab`, Nix, WakeMeOps (Debian/Ubuntu), Spack.
  - Docker: `gitlab/glab`.
- glab supports GitLab 16.0 and later; some commands need newer versions [S22].

### 8. Unverified or open

- docs.gitlab.com could not be fetched: the egress proxy returned 403 for `docs.gitlab.com` (organization policy), and
  WebFetch could not resolve it. I cited the source docs at tag v1.123.0 instead. The repo states that `docs/source`
  is what docs.gitlab.com/cli publishes: `docs/navigation-glab.yaml` "is spliced into the GitLab CLI (glab) section"
  of docs.gitlab.com, and the README links `docs.gitlab.com/cli/...`. The published URLs are listed in Sources but
  were not opened.
- Nothing ran against a real gitlab.com or self-managed 18.x Instance. Still open:
  - whether `glab issue view` and `glab issue note` work on Task IIDs;
  - whether the hard-coded Work Item type IDs match on self-managed;
  - the real OAuth refresh round trip;
  - `work-items` behavior on 18.x.
- The OS keyring paths (macOS Keychain, Windows Credential Manager, Linux Secret Service) were not exercised, and
  neither were Windows or macOS installs.
- The exact REST or GraphQL calls for resolving an Issue or Work Item Thread, and for Epic Comments, are out of scope
  here (ticket 01).

## Sources

All repository paths are in https://gitlab.com/gitlab-org/cli at tag `v1.123.0` (commit 5686d748), unless another repo
is named. `docs/source/<x>.md` is published at `https://docs.gitlab.com/cli/<x>/`, but docs.gitlab.com was not
reachable from this session.

- [S1] Release v1.123.0 (2026-10-13) and its assets: https://gitlab.com/gitlab-org/cli/-/releases/v1.123.0 (via `GET https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases`)
- [S2] `docs/source/work-items/_index.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/work-items/_index.md (https://docs.gitlab.com/cli/work-items/)
- [S3] `docs/source/work-items/{list,create,update,delete}.md` and `internal/commands/workitems/{create/create.go,update/update.go}`: https://gitlab.com/gitlab-org/cli/-/tree/v1.123.0/docs/source/work-items , https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/workitems/update/update.go
- [S4] `internal/commands/workitems/api/api.go` (list GraphQL queries, lines 39-87): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/workitems/api/api.go
- [S5] `docs/source/issue/` and `docs/source/incident/`: https://gitlab.com/gitlab-org/cli/-/tree/v1.123.0/docs/source/issue
- [S6] `docs/source/issue/note.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/issue/note.md
- [S7] `docs/source/mr/note/resolve.md` and siblings: https://gitlab.com/gitlab-org/cli/-/tree/v1.123.0/docs/source/mr/note
- [S8] Bundled agent skill `internal/commands/skills/bundled/assets/glab/SKILL.md` (lines 139-157, 219-223, 277-280): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/skills/bundled/assets/glab/SKILL.md
- [S9] `docs/source/api/_index.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/api/_index.md (https://docs.gitlab.com/cli/api/)
- [S10] Local verification: glab v1.123.0 `linux_amd64` binary (sha256 `9c9ac4c2...9bef`, matching the release `checksums.txt`) run with an isolated `GLAB_CONFIG_DIR` against a local mock HTTP server that logged request bodies and auth headers. Covered: `api graphql` variables, `--paginate`, `--input`, `-F @file`, error exit codes, token precedence, `auth status`, `config get`, `mcp serve` tools/list and tools/call.
- [S11] `docs/source/authentication.md` (token precedence, credential storage, Claude Code sandboxing): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/authentication.md (https://docs.gitlab.com/cli/authentication/)
- [S12] `docs/source/configuration.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/configuration.md (https://docs.gitlab.com/cli/configuration/)
- [S13] `internal/config/schema.go` (key schema, env var names, keyring eligibility): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/config/schema.go
- [S14] `docs/source/auth/login.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/auth/login.md
- [S15] `internal/api/client.go` `NewClientFromConfig` (lines 342-459): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/api/client.go
- [S16] `internal/cmdutils/factory.go` (`ApiClient`, default hostname): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/cmdutils/factory.go
- [S17] `internal/oauth2/token_source.go` (single-use refresh, write-back, 5-minute grace) and `internal/oauth2/config.go` (scopes, redirect): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/oauth2/token_source.go
- [S18] `internal/commands/config/get/config_get.go` and `docs/source/config/get.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/config/get/config_get.go
- [S19] `internal/commands/auth/status/status.go` and `docs/source/auth/status.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/auth/status/status.go
- [S20] `docs/source/mcp/_index.md` and `docs/source/mcp/serve.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/mcp/serve.md (https://docs.gitlab.com/cli/mcp/serve/)
- [S21] `internal/commands/mcp/serve/server.go` (registration lines 91-128, subprocess lines 623-650, `defaultResponseLimit`): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/mcp/serve/server.go
- [S22] `README.md` (Requirements, Installation): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/README.md
- [S23] `docs/installation_options.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/installation_options.md
- [S24] Release notes: v1.87.0 (work-items list), v1.94.0 (create, delete), v1.98.1 (update), v1.100.0 (issue accepts work_items URLs), v1.86.0 (MCP auto JSON; unannotated commands not registered), v1.111.0 (keyring by default): https://gitlab.com/gitlab-org/cli/-/releases
- [S25] `internal/commands/workitems/utils/scope.go`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/workitems/utils/scope.go
- [S26] gitlab-org/api/client-go v3.18.0 (glab's pinned dependency, `go.mod` line 48), `workitems.go` (options at lines 930-984 and 1316-1364, type IDs at lines 1972-1980, "Experimental" notes): https://gitlab.com/gitlab-org/api/client-go/-/blob/v3.18.0/workitems.go
- [S27] `internal/commands/workitems/delete/delete.go`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/workitems/delete/delete.go
- [S28] `internal/commands/workitems/utils/types.go`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/workitems/utils/types.go
- [S29] `internal/commands/issuable/view/issuable_view.go` and `docs/source/issue/view.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/issuable/view/issuable_view.go
- [S30] `internal/commands/issue/issueutils/utils.go` (URL regex, line 162): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/issue/issueutils/utils.go
- [S31] `docs/source/issue/create.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/issue/create.md
- [S32] `internal/commands/issue/create/issue_create.go` (lines 31, 202, 473-474): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/issue/create/issue_create.go
- [S33] `docs/source/issue/update.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/docs/source/issue/update.md
- [S34] `internal/commands/issuable/note/issuable_note_create.go` (line 90): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/issuable/note/issuable_note_create.go
- [S35] `internal/commands/issuable/list/issuable_list.go` (lines 126-144, 179, 377-400) and `docs/source/issue/list.md`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/issuable/list/issuable_list.go
- [S36] `internal/commands/mr/note/mr_note_resolve.go` (line 146): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/mr/note/mr_note_resolve.go
- [S37] `internal/commands/api/api.go` (paginate/input exclusivity line 340; request loop lines 435-545; response and error handling lines 547-608; `parseErrorResponse` lines 1172-1227): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/api/api.go
- [S38] `internal/commands/api/http.go` (`groupGraphQLVariables`, lines 83-100): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/api/http.go
- [S39] Same as [S9], the `--field`, `--raw-field`, `--input`, and `--paginate` sections.
- [S40] `internal/commands/api/pagination.go` (`findEndCursor`): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/commands/api/pagination.go
- [S41] `cmd/glab/main.go` (exit codes, lines 167-180): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/cmd/glab/main.go
- [S42] `internal/config/config_file.go` (search order, 0600 write): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/config/config_file.go
- [S43] `internal/config/config.go` (`GetWithSource` lines 248-335; keyring key format lines 383-448): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/config/config.go
- [S44] `go.mod` (`github.com/zalando/go-keyring v0.2.8`, `gitlab.com/gitlab-org/api/client-go/v3 v3.18.0`): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/go.mod
- [S45] `internal/config/config.go` `GetFromEnvWithSource` (lines 895-925) and `internal/config/config_mapping.go` `EnvKeyEquivalence`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/config/config_mapping.go
- [S46] `internal/oauth2/config.go` (redirect URL and scopes, lines 19-23): https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/oauth2/config.go
- [S47] `internal/mcpannotations/annotations.go`: https://gitlab.com/gitlab-org/cli/-/blob/v1.123.0/internal/mcpannotations/annotations.go
