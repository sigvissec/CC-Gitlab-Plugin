# Claude Code plugin format: components, configuration, distribution

Research for ticket 04, "What can a Claude Code plugin contain, and how is it configured?"
(`.scratch/gitlab-work-items-plugin/issues/04-claude-code-plugin-format.md`).

- Researched 2026-10-13 against Claude Code's official docs, fetched as raw Markdown from
  code.claude.com on that date, and Anthropic's plugin repositories.
- Local checks used the Claude Code CLI 2.1.296 in this repo's cloud container.
- Terms follow `GLOSSARY.md`: Instance, Work Item, Issue, Task, Epic, Comment, Thread.

## Answer

- **A plugin is a directory, not a package.** It has an optional manifest at `.claude-plugin/plugin.json`, in which
  only `name` is required, plus components in default locations: `skills/`, `commands/` (the legacy form),
  `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `workflows/`,
  `bin/`, a root `settings.json`, message `channels`, and a JavaScript hooks module (a "mod"). Everything is
  namespaced by the plugin name. For a plugin named `gitlab-work-items`, a skill runs as
  `/gitlab-work-items:review-work-item`, its MCP server is `plugin:gitlab-work-items:gitlab`, and that server's tools
  are `mcp__plugin_gitlab-work-items_gitlab__<tool>`.
  [[manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#standard-layout),
  [components](https://code.claude.com/docs/en/plugins/components)]
- **A bundled MCP server can be anything Claude Code can launch or reach.** Declare it in `.mcp.json` at the plugin
  root or inline under `mcpServers`. It can be:
  - a stdio command: a script shipped in the plugin and referenced through `${CLAUDE_PLUGIN_ROOT}`, a binary, `npx`,
    or `uvx`;
  - a `.mcpb` bundle;
  - a remote `http`, `sse`, or `ws` URL.

  Claude Code starts the server automatically while the plugin is enabled. Remote HTTP servers get OAuth 2.0, with
  dynamic client registration, CIMD, or a pre-registered client, through `/mcp` or `claude mcp login`.
  [[mcp](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers),
  [manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#mcpservers)]
- **Per-install settings and secrets go in `userConfig`.** Each option has a type, a title, a description, an
  optional default, and `sensitive: true` for tokens.
  - **Prompting:** Claude Code prompts for unset options when the plugin is installed or enabled through `/plugin`,
    or through `/plugin configure`. From the shell, use `claude plugin install --config KEY=VALUE` or
    `claude plugin configure --values-stdin`.
  - **Storage:** non-sensitive values go to `pluginConfigs` in user settings. Sensitive values go to the macOS
    Keychain or to `~/.claude/.credentials.json`.
  - **Use:** components read a value as `${user_config.KEY}` (in MCP `command`, `args`, `env`, `url`, and `headers`)
    or as `CLAUDE_PLUGIN_OPTION_<KEY>` (in hooks).

  I verified this locally with an Instance host option and a token option.
  [[manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#user-configuration),
  [settings-reference](https://code.claude.com/docs/en/settings-reference#pluginconfigs), local check §7]
- **Environment variables also work, so the `GITLAB_TOKEN` and `glab` fallback can live inside the server.**
  `.mcp.json` expands `${VAR}` and `${VAR:-default}`, and a plugin's stdio MCP server inherits the user's environment.
  In a local check, `GITLAB_TOKEN` reached the server both directly and through `${GITLAB_TOKEN}`. Two traps:
  - An unset sensitive option substitutes as an empty string.
  - Setting an `Authorization` header on a remote server turns off its OAuth fallback.

  [[mcp](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json), local check §7]
- **Skills are the slash commands.** `skills/<name>/SKILL.md` runs as `/<plugin>:<name>`, and Claude can also invoke
  it. `commands/*.md` is the older single-file form, with the same frontmatter.
  - `disable-model-invocation: true` makes a skill user-only. That is the right default for creating Work Items.
  - `user-invocable: false` makes a skill Claude-only.

  [[skills](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill),
  [components](https://code.claude.com/docs/en/plugins/components#commands)]
- **Skills can run shell commands, under the normal permission system.**
  - `allowed-tools` pre-approves tools, such as `Bash(glab api *)` or a plugin MCP tool name, for the turn that invokes
    the skill. Everything else still prompts.
  - `` !`cmd` `` lines run before the skill renders and never prompt. They abort the skill unless a permission rule or
    `allowed-tools` allows the command.
  - Hooks, monitors, and MCP and LSP server processes run as the user, outside the permission system and the sandbox.
  - An MCP server can force a prompt on every call of a tool by setting `_meta["anthropic/requiresUserInteraction"]`.

  [[skills](https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill),
  [security](https://code.claude.com/docs/en/plugins/security#understand-what-a-plugin-can-do),
  [mcp](https://code.claude.com/docs/en/mcp#require-approval-for-a-specific-tool)]
- **Distribution is a git repo with `.claude-plugin/marketplace.json`.** The marketplace file can sit in the plugin's
  own repo (`"source": "./"`), and hosting on GitLab works with a full `https://…git` URL.
  - Users run `claude plugin marketplace add <source>`, then `claude plugin install <plugin>@<marketplace>`, or do
    both in one step with `--marketplace`.
  - A repo can declare `extraKnownMarketplaces` and `enabledPlugins` in its `.claude/settings.json`. These apply after
    workspace trust, and a plugin with an external source still needs a per-user install.
  - A pinned `version` keeps users on that version until it changes. Auto-update is off by default for third-party
    marketplaces.

  [[create-marketplace](https://code.claude.com/docs/en/plugins/create-marketplace),
  [publish](https://code.claude.com/docs/en/plugins/publish#publish-through-your-own-marketplace),
  [org](https://code.claude.com/docs/en/plugins/org#require-plugins-per-repository),
  [loading](https://code.claude.com/docs/en/plugins/loading#versions-and-updates)]
- **Cloud sessions (claude.ai/code) are the weak spot.**
  - **What's missing:** they have no `/plugin`, and they don't load plugins from user settings or from a repo's
    `enabledPlugins` and `extraKnownMarketplaces`.
  - **What reaches them:** an organization's server-managed settings, set by a Team or Enterprise Owner, and anything
    committed to the repo: `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `.mcp.json`, and hooks.
  - **Secrets:** they come from environment variables, which everyone using the environment can read, or, on Pro and
    Max only, from network secrets that the proxy injects as a header.
  - **Network:** `gitlab.com` is on the default Trusted allowlist. A self-managed Instance needs a Custom allowlist
    entry.

  [[cloud-environments](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup),
  [install](https://code.claude.com/docs/en/plugins/install#install-a-plugin),
  [org](https://code.claude.com/docs/en/plugins/org#when-each-surface-applies-the-plugin-keys)]

## Detail

### 1. Sources and method

The plugin docs were reorganized under `/docs/en/plugins/…`. Each old URL named in the ticket still serves content,
and I confirmed with `cmp` that each serves a byte-identical copy of its new page:

| Old URL | New page |
| :- | :- |
| `/docs/en/plugins` | `/docs/en/plugins/overview` |
| `/docs/en/plugins-reference` | `/docs/en/plugins/manifest-reference` |
| `/docs/en/plugin-marketplaces` | `/docs/en/plugins/create-marketplace` |
| `/docs/en/discover-plugins` | `/docs/en/plugins/install` |
| `/docs/en/slash-commands` | `/docs/en/skills` |

This note cites the new URLs.

The probe files for the local checks lived in a scratch directory outside the repo, and the install checks used an
isolated `CLAUDE_CONFIG_DIR`:

- **Example plugin:** I built the example in [§12](#12-minimal-example-layout) and ran `claude plugin validate`
  (plain and `--strict`) and `claude --plugin-dir … plugin details`.
- **Probe server:** I ran `claude --plugin-dir … mcp list` against a probe stdio server that records the environment
  it receives.
- **Real install:** I installed the plugin from a local `directory` marketplace into an isolated `CLAUDE_CONFIG_DIR`,
  with `--config` values.
- **Header logger:** I pointed a remote `http` server entry at a localhost listener that logs request headers.

These checks show how the CLI behaves. They don't show what a claude.ai/code session's runtime loads.

### 2. What a plugin can contain

| Component | Default location | Manifest key, and how it combines with the default | How it appears |
| :- | :- | :- | :- |
| Manifest | `.claude-plugin/plugin.json` | — | Optional. Without it, the name comes from the marketplace entry or the directory |
| Skills | `skills/<name>/SKILL.md`, or one `SKILL.md` at the root | `skills`: **adds** directories | `/<plugin>:<name>` |
| Commands (legacy) | `commands/*.md` | `commands`: **replaces**. Accepts a path, an array, or an object map | `/<plugin>:<file>`. A subdirectory adds a `:` segment |
| Agents | `agents/*.md`, recursive | `agents`: **replaces**. Files only | `<plugin>:<name>`, invoked with `@agent-<plugin>:<name>` |
| Hooks | `hooks/hooks.json` | `hooks`: **merges** | Fire on lifecycle events from session load |
| Hooks module (mod) | listed under `modules` in `hooks/hooks.json` | — | JS handlers that can draw panes and add commands |
| MCP servers | `.mcp.json` | `mcpServers`: **merges**. A later name replaces an earlier one | `plugin:<plugin>:<server>` in `/mcp` |
| LSP servers | `.lsp.json` | `lspServers`: **merges** | Diagnostics and navigation. The binary must be on `PATH` |
| Output styles | `output-styles/*.md` | `outputStyles`: **replaces** | `<plugin>:<name>` in `/output-style` |
| Themes | `themes/*.json` | `experimental.themes` | Listed in `/theme` |
| Monitors | `monitors/monitors.json` | `experimental.monitors` | A background shell command whose output reaches Claude as notifications. Interactive sessions only |
| Workflows | `workflows/*.js` | `workflows` | `/<plugin>:<workflow>` |
| Executables | `bin/` | — | On the Bash tool's `PATH`, after the user's own entries |
| Default settings | `settings.json` | `settings` | Only `agent` and `subagentStatusLine` take effect |
| Channels | — | `channels`, each bound to one of the plugin's MCP servers | A chat bridge into the session |
| Plugin dependencies | — | `dependencies` | Other plugins installed and enabled alongside |
| Evals | `evals/` | `experimental.evals` | `claude plugin eval` |

Sources: [manifest-reference: fields](https://code.claude.com/docs/en/plugins/manifest-reference#fields) and
[standard layout](https://code.claude.com/docs/en/plugins/manifest-reference#standard-layout);
[components](https://code.claude.com/docs/en/plugins/components);
[mods overview](https://code.claude.com/docs/en/plugins/mods/overview).

Rules worth knowing:

- **Layout:**
  - Only `plugin.json` goes inside `.claude-plugin/`. Components saved there don't load.
    [[create](https://code.claude.com/docs/en/plugins/create#plugin-layout)]
  - A `CLAUDE.md` at the plugin root isn't loaded. Put standing instructions in a skill.
    [[manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#standard-layout)]
- **Agents:** a plugin agent's `permissionMode`, `hooks`, `mcpServers`, and `initialPrompt` frontmatter is ignored.
  Hooks and MCP servers belong to the plugin, not the agent.
  [[components](https://code.claude.com/docs/en/plugins/components#frontmatter-fields-in-plugin-agents)]
- **Hooks:**
  - Plugin hooks register when the plugin loads. They don't wait for one of its skills to run.
    [[components](https://code.claude.com/docs/en/plugins/components#when-plugin-hooks-fire)]
  - A hook matcher for the plugin's own MCP tools must use the full `mcp__plugin_<plugin>_<server>__<tool>` name.
    [[components](https://code.claude.com/docs/en/plugins/components#environment-quoting-and-matching-mcp-tools)]
- **Monitors:** a monitor can't use `${user_config.*}`, and it doesn't start under `-p`.
  [[components](https://code.claude.com/docs/en/plugins/components#monitors)]
- **`bin/`:** claude.ai and Cowork refuse to install a plugin that has a top-level `bin/`. Claude Code accepts it.
  [[components](https://code.claude.com/docs/en/plugins/components#executables),
  [platform support](https://claude.com/docs/plugins/platform-support#compare-component-support-by-app)]

### 3. `plugin.json`

Only `name` is required. Fields relevant to this plugin:

| Field | Notes |
| :- | :- |
| `name` | Use kebab-case. Every component is namespaced under it. These names fail validation: names starting with `claude-`, `anthropic-`, `anthropics-`, or `cc-plugin-`; the exact names `claude`, `claude-code`, and similar; and names that put `official` beside `claude` or `anthropic`. Having `claude` or `anthropic` as a whole word elsewhere in the name draws only a warning. `gitlab-work-items` is fine |
| `displayName` | Shown in the UI in place of `name` |
| `version` | Not checked against semver. It **pins** users to this version until you change it. Omit it to track commits |
| `description`, `author` (`name` required), `homepage` (must parse as a URL), `repository`, `license`, `keywords` | Metadata |
| `defaultEnabled` | Defaults to `true` |
| `dependencies` | `"name"`, `"name@marketplace"`, or an object with a version |
| `userConfig` | Per-install options. See [§7](#7-per-install-configuration-and-secrets) |
| `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`, `workflows`, `settings`, `channels`, `experimental` | Component overrides. See [§2](#2-what-a-plugin-can-contain) |

Source: [manifest-reference: fields](https://code.claude.com/docs/en/plugins/manifest-reference#fields).

Path and validation rules, all from the
[manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference#path-rules):

- **Paths:**
  - Every component path is relative to the plugin root and starts with `./`.
  - A path must stay inside the root and must exist. A path with `..` fails.
  - `skills` also accepts `"."`. `mcpServers` also accepts an `https://` bundle URL.
- **Unknown keys:**
  - An unknown top-level key is stripped, with a validator warning.
  - An unknown key inside a `userConfig`, `channels`, `lspServers`, or `monitors` entry is an error, and the plugin
    doesn't load.
- **Validator:**
  - `claude plugin validate [--strict] <dir>` is the authoritative check.
  - From 2.1.281, it also checks MCP entries. A `${user_config.KEY}` reference to an undeclared option is an error.
    An `http://` URL to a non-loopback host, or a header value that looks like a literal credential, is a warning.

**Path variables.** Claude Code provides three path variables:

| Variable | Resolves to |
| :- | :- |
| `${CLAUDE_PLUGIN_ROOT}` | The installed version's directory. It changes on every update, so don't write state there |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/<id>/`. It persists across updates and is deleted on the last uninstall |
| `${CLAUDE_PROJECT_DIR}` | The project root |

Where the variables apply:

- **MCP stdio servers:** they resolve in `command`, `args`, and `env`, and `CLAUDE_PLUGIN_ROOT` and
  `CLAUDE_PLUGIN_DATA` are also exported to the process. My local check also saw `CLAUDE_PROJECT_DIR` in the
  process environment.
- **MCP `http`, `sse`, and `ws` servers:** they resolve in `url`, `headers`, and `headersHelper`.
- **Hooks:** they resolve in `command` and `args`.
- **Skill, command, and agent Markdown:** they're substituted in the body.
- **Bash tool:** the variables are **not** in the environment of commands Claude runs through the Bash tool.

Source: [manifest-reference: environment variables](https://code.claude.com/docs/en/plugins/manifest-reference#environment-variables).
In skills, Claude Code also substitutes `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`,
`$ARGUMENTS`, `$0`/`$1`…, and named `$arguments`
[[skills](https://code.claude.com/docs/en/skills#available-string-substitutions)].

### 4. Skills and slash commands

**Naming.**

- `my-plugin/skills/review/SKILL.md` runs as `/my-plugin:review`.
- Frontmatter `name: fancy` replaces the last segment, giving `/my-plugin:fancy`. The bare `/fancy` also invokes it
  unless another command already uses that name.
- `commands/db/migrate.md` runs as `/my-plugin:db:migrate`.
- In my local check, `claude plugin details` counted the `commands/` file as one of the plugin's skills.

Sources: [skills](https://code.claude.com/docs/en/skills#how-a-skill-gets-its-command-name),
[components](https://code.claude.com/docs/en/plugins/components#commands).

**Frontmatter.** These fields are the ones that matter here; all are optional. Source:
[skills: frontmatter reference](https://code.claude.com/docs/en/skills#frontmatter-reference).

- **Describing the skill:**
  - `description` tells Claude when to use the skill. Combined with `when_to_use`, it's truncated at 1,536 characters
    in the listing.
  - `argument-hint` and `arguments` define the skill's arguments.
- **Who can invoke it:** `disable-model-invocation` and `user-invocable` (table below).
- **Tools:** `allowed-tools` pre-approves tools for one turn; `disallowed-tools` removes tools.
- **Model and effort:** `model` and `effort`.
- **Isolation:** `context: fork`, with `agent` and `background`, runs the skill in a subagent.
- **Other:** `hooks`, `paths` (globs that limit auto-activation), and `shell` (`bash` or `powershell` for injected
  commands).

| Frontmatter | You can invoke | Claude can invoke | Description in context every turn |
| :- | :- | :- | :- |
| (default) | Yes | Yes | Yes |
| `disable-model-invocation: true` | Yes | No | No |
| `user-invocable: false` | No | Yes | Yes |

Source: [skills](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill). The name and description of
every skill that Claude can invoke cost context on every turn of every session where the plugin is enabled
[[overview](https://code.claude.com/docs/en/plugins/overview#what-an-enabled-plugin-adds-to-your-sessions)].

**Defining commands in the manifest.** The `commands` key also takes an object map of
`{name: {source | content, description, argumentHint, model, allowedTools}}`
[[manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#commands)].

### 5. Shell commands and permission prompts

**Claude's own tool calls from a skill.** These go through normal permissions.

- `allowed-tools` grants the listed tools during the turn that invokes the skill, and the grant clears with the next
  user message. It doesn't restrict other tools, and deny and ask rules still win.
- Workspace trust doesn't gate `allowed-tools`. If managed settings set `allowManagedPermissionRulesOnly`, Claude Code
  ignores the field.
- Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, and `${CLAUDE_SKILL_DIR}` inside
  `allowed-tools` Bash rules. A plugin skill can therefore pre-approve its own bundled script, for example
  `allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/gl.sh *)`.

Source: [skills](https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill),
[substitutions](https://code.claude.com/docs/en/skills#available-string-substitutions).

**Injected commands (`` !`cmd` `` and ` ```! ` blocks).**

- They run before Claude sees the skill, and their output replaces the placeholder.
- They never prompt. A command that a deny rule matches aborts the skill. Outside auto mode, a command whose check
  returns anything other than allow also aborts it. Pre-approve the command with `allowed-tools` to avoid that.
- A non-zero exit aborts the invocation. Append `|| true` to commands expected to exit non-zero.
- `disableSkillShellExecution: true` in settings turns injection off for plugin skills.

Source: [skills](https://code.claude.com/docs/en/skills#inject-dynamic-context).

**Plugin MCP tools and `bin/` executables.** Calls to them are tool calls, so permission rules apply.

- Allow rules name the full tool, as in `mcp__plugin_<plugin>_<server>__<tool>`, or a server-wide
  `mcp__plugin_<plugin>_<server>__*`.
- An unanchored glob such as `mcp__*` is skipped and doesn't auto-approve anything.

Source: [security](https://code.claude.com/docs/en/plugins/security#understand-what-a-plugin-can-do),
[permissions](https://code.claude.com/docs/en/permissions#mcp),
[mcp](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers).

**Forcing approval.** A server can mark a tool with `_meta["anthropic/requiresUserInteraction"]: true`. That tool
then prompts on every call, even in `auto` and `bypassPermissions` modes, and allow rules can't skip the prompt.
In `dontAsk` mode, the call is denied instead.
[[mcp](https://code.claude.com/docs/en/mcp#require-approval-for-a-specific-tool)]

**Code the plugin runs by itself.** Hooks, monitors, and MCP and LSP server processes run with the user's full
privileges and outside the sandbox. Permission rules don't cover them.
[[security](https://code.claude.com/docs/en/plugins/security#understand-what-a-plugin-can-do)]

### 6. MCP servers in a plugin

**Declaring a server.**

- Put it in `.mcp.json` at the plugin root. The `mcpServers` wrapper is optional, and the shape is the same as a
  project `.mcp.json`.
- Or put it inline under `mcpServers` in `plugin.json`, as a `.json` path, or as a `.mcpb`/`.dxt` bundle path or URL.
  A manifest server replaces a `.mcp.json` server of the same name.

Source: [components](https://code.claude.com/docs/en/plugins/components#mcp-servers),
[manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#mcpservers).

**Ways to launch a server:**

| Shape | Example | Notes |
| :- | :- | :- |
| Script bundled in the plugin | `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server/index.js"]` | See dependency handling below |
| Bundled binary | `"command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server"` | Docs example [[mcp](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers)]. Cloud VMs are Ubuntu x86_64 [[cloud-environments](https://code.claude.com/docs/en/cloud-environments#whats-available-in-cloud-sessions)] |
| Package runner | `"command": "npx", "args": ["-y", "@example/mcp-server"]`, or `uvx …` | The same stdio entry shape the docs give for `npx`, `uvx`, or binary commands [[mcp](https://code.claude.com/docs/en/mcp#add-a-server-from-an-npx-uvx-or-binary-command)]. The runner must be on the user's machine (inferred) |
| MCPB bundle | `"mcpServers": "./servers/db.mcpb"` or an `https://` URL | Extracted to `.mcpb-cache/`. The bundle's own `user_config` is set with `/plugin` → **Configure**, or `--config <server>.<key>=…` [[components](https://code.claude.com/docs/en/plugins/components#include-a-packaged-mcpb-server)] |
| Remote | `{"type": "http", "url": "https://gitlab.com/api/v4/mcp"}` | `type` is required. `streamable-http` is an alias. `sse` is deprecated, and `http` falls back to SSE automatically. `ws` authenticates by header only [[mcp](https://code.claude.com/docs/en/mcp#option-1-add-a-remote-http-server)] |

**Dependencies of a bundled script.**

- When Claude Code copies a marketplace plugin into its cache, it runs `npm` or `bun` itself. This needs a
  `package.json` plus a `package-lock.json`, `npm-shrinkwrap.json`, or `bun.lock` at the plugin root.
- The install has limits: registry packages pinned in the lockfile only, `--ignore-scripts`, and a 60-second timeout.
- For anything else, such as Python dependencies or native builds, run a `SessionStart` hook that installs into
  `${CLAUDE_PLUGIN_DATA}`.

Source: [loading](https://code.claude.com/docs/en/plugins/loading#nodejs-package-dependencies),
[components](https://code.claude.com/docs/en/plugins/components#install-dependencies-into-the-data-directory).

**Lifecycle.**

- Servers connect at session start while the plugin is enabled, and reconnect or disconnect when the plugin is
  enabled or disabled.
- Users can toggle a plugin server off in `/mcp`. Plugin servers aren't added or removed with `claude mcp`.
- In cloud sessions, a server that isn't connected yet starts on its first call.
- `claude mcp get` shows a plugin stdio server's `env` values as `[REDACTED]`.

Source: [mcp](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers).

**Precedence.**

- The order is local, then project, then user scope, then plugin servers, then claude.ai connectors.
- Plugins and connectors are matched against higher-precedence servers **by endpoint**. If a user already has a server
  pointing at the same URL or command, the user's own definition wins.

Source: [mcp](https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence).

**Repo-committed plugins.** A plugin that a repository supplies, such as a project `@skills-dir` plugin, needs the
same per-server approval as a project `.mcp.json`. MCP bundles in such a plugin are skipped, and its monitors don't
load. Personal-scope plugins have none of these restrictions.
[[loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository)]

**OAuth for remote servers.**

- **Sign-in:** a `401` or `403` flags the server in `/mcp`. The user signs in from `/mcp` or with
  `claude mcp login <name>`, which supports `--no-browser`.
- **Tokens:** they're stored securely and refreshed automatically. A rejected refresh token prompts re-authentication.
- **Client registration:** discovery tries RFC 9728, then RFC 8414. Claude Code supports dynamic client registration
  and CIMD. For servers without either, use a pre-registered client: `--client-id`, `--client-secret` (stored in the
  keychain or credentials file), and `--callback-port`.
- **Overrides:** the config's `oauth` object takes `clientId`, `callbackPort`, `authServerMetadataUrl`, and `scopes`.
- **Limits:** OAuth can't run in non-interactive (`-p`) sessions. The v2 MCP runtime sends credentials only to HTTPS
  or loopback token endpoints.

Source: [mcp: authenticate](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers),
[pre-configured credentials](https://code.claude.com/docs/en/mcp#use-pre-configured-oauth-credentials),
[client runtimes](https://code.claude.com/docs/en/mcp#mcp-client-runtimes).

**An `Authorization` header turns off OAuth.** If a server's `Authorization` header is configured, through `headers` or
a `headersHelper`, and the server rejects it, Claude Code reports a failed connection instead of falling back to
OAuth [[mcp](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers)]. My local check saw
`Server rejected the configured Authorization header (HTTP 401) … OAuth fallback is disabled when
headers.Authorization is set`.

**`headersHelper`.** This runs a shell command that prints JSON headers, with a 10-second limit.

- For a plugin, it runs from the plugin root with `CLAUDE_PLUGIN_ROOT` set.
- Credential-looking variables, such as names containing `TOKEN`, `SECRET`, or `KEY`, are **removed** from its
  environment.
- It can't reference `${user_config.*}`. Put that in `headers` instead.

Source: [mcp](https://code.claude.com/docs/en/mcp#use-dynamic-headers-for-custom-authentication).

**Placeholder servers.** A remote entry with an empty `url` shows as `not configured`. It isn't treated as an error,
so a plugin can ship a placeholder.
[[mcp](https://code.claude.com/docs/en/mcp#server-status-detail)]

### 7. Per-install configuration and secrets

**The `userConfig` option schema.** Keys are letters, digits, and `_`, and can't start with a digit. Each option is a
strict object:

| Field | Required | Meaning |
| :- | :- | :- |
| `type` | yes | `string`, `number`, `boolean`, `directory`, or `file` |
| `title`, `description` | yes | Shown in the dialog |
| `required` | no | The dialog rejects an empty value |
| `default` | no | A string, number, boolean, or array of strings |
| `options` | no | A fixed picker for a string. Needs Claude Code ≥ 2.1.271 |
| `multiple` | no | Allows an array of strings |
| `sensitive` | no | Masks input and stores the value in secure storage |
| `min`, `max` | no | Bounds for a number |

Source: [manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#user-configuration).

**When users are asked for values:**

- **In a session:** a dialog opens for unset options on install or enable through `/plugin`, and on
  `/plugin install <p>@<m>`. `/plugin configure <p>@<m>` reopens it at any time.
- **VS Code:** the extension shows a form after install.
- **From the shell:** `claude plugin install` **never** prompts. Use `--config KEY=VALUE`, or pipe JSON to
  `claude plugin configure <p>@<m> --values-stdin`.
- **`--plugin-dir`:** loading this way doesn't show the dialog. Run `/plugin configure`.
- **`/config`:** non-sensitive options also appear as rows there, from 2.1.269.

Source: [components](https://code.claude.com/docs/en/plugins/components#when-the-configuration-dialog-appears),
[cli-reference](https://code.claude.com/docs/en/plugins/cli-reference#plugin-configure),
[create](https://code.claude.com/docs/en/plugins/create#the-userconfig-dialog-never-appears).

**Where values are stored.**

- Non-sensitive values go under `pluginConfigs["<plugin>@<marketplace>"].options` in **user** settings. Claude Code
  ignores project and local entries, so a cloned repo can't supply them.
- Sensitive values go to the macOS Keychain, falling back to `~/.claude/.credentials.json`. Platforms without a
  supported keychain use the file.

Source: [settings-reference](https://code.claude.com/docs/en/settings-reference#pluginconfigs).

**Where a component can read a value.**

- `${user_config.KEY}` is substituted in:
  - MCP config, LSP config, and exec-form hook `args`;
  - skill and agent text, but only for non-sensitive values. A sensitive value appears there as a placeholder.
- `CLAUDE_PLUGIN_OPTION_<KEY>` is exported to every hook process.
- Shell-form hook commands, monitor commands, and MCP `headersHelper` **reject** `${user_config.*}`.

Source: [manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference#reference-a-saved-value).

**Environment variable expansion.** `.mcp.json` supports `${VAR}` and `${VAR:-default}`.

- **Where it applies:** in `command`, `args`, `env`, `url`, and `headers`.
- **Unset variables:** an unset variable with no default stays as literal `${VAR}` text, with a warning.
- **Credential variables:** in a remote server's `url` and `headers`, some credential variables are always read as
  empty. Examples are `ANTHROPIC_API_KEY`, cloud-provider tokens, `HTTPS_PROXY`, and `NPM_TOKEN`. The docs give
  examples, not the full list.

Source: [mcp](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json). There is no
plugin-level keychain integration for arbitrary variables. Reusing a `glab` login would be the MCP server's own job,
reading `glab`'s config; ticket 03 covers that.

**Local check results** (Claude Code 2.1.296, Linux, isolated config dir):

| Check | Observed |
| :- | :- |
| Unset non-sensitive option with `default: "gitlab.com"`, used in stdio `env` | `GITLAB_HOST=gitlab.com` |
| Unset sensitive option, used in stdio `env` | Empty string |
| `claude plugin install … --config gitlab_host=… --config gitlab_token=…` | Host saved in `settings.json` under `pluginConfigs`. Token saved in `.credentials.json` under `pluginSecrets`, and not in `settings.json` |
| Configured sensitive option in stdio `env` and in remote `headers` | Substituted in both |
| `"url": "http://${user_config.host}/api/v4/mcp"` | Substituted, so a per-install Instance host works for remote servers |
| User's `GITLAB_TOKEN` set in the shell | Inherited by the plugin's stdio server. `${GITLAB_TOKEN:-unset}` in `env` expanded to the value |
| `Bearer ${GITLAB_TOKEN}` in a plugin remote server's `headers` | Expanded, not read as empty. A renamed variable (`${MY_GL_PAT}`) also expanded |
| Process environment of the stdio server | `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, and `CLAUDE_PROJECT_DIR` present |

### 8. Namespacing summary

| Thing | Name |
| :- | :- |
| Skill | `/<plugin>:<dir-or-frontmatter-name>` |
| Command file | `/<plugin>:<file>`. A subdirectory adds a `:` segment |
| Agent | `<plugin>:<name>`, invoked with `@agent-<plugin>:<name>`. Subfolders add segments |
| MCP server | `plugin:<plugin>:<server>` |
| MCP tool | `mcp__plugin_<plugin>_<server>__<tool>`. Characters outside `A-Za-z0-9_-` become `_` |
| Output style | `<plugin>:<name>` |
| Plugin id | `<entry-name>@<marketplace>`. Also `@inline` (`--plugin-dir`), `@skills-dir`, and `@synced` (from a claude.ai account) |
| Data directory | `~/.claude/plugins/data/<id>`. Characters outside `A-Za-z0-9_-` become `-` |

Sources: [components](https://code.claude.com/docs/en/plugins/components),
[mcp](https://code.claude.com/docs/en/mcp#plugin-provided-mcp-servers),
[loading](https://code.claude.com/docs/en/plugins/loading#find-where-a-plugin-came-from).

The marketplace entry name is the install key, and the manifest `name` is the namespace. Keep the two the same
[[create-marketplace](https://code.claude.com/docs/en/plugins/create-marketplace#keep-the-entry-name-and-the-manifest-name-the-same)].

### 9. Distribution and updates

**The marketplace file.** `.claude-plugin/marketplace.json` requires `name`, `owner.name`, and `plugins[]`, and each
entry requires `name` and `source`.

- An entry can also carry `description`, `version`, `category`, `tags`, `strict`, `dependencies`, `defaultEnabled`,
  `displayName`, and most `plugin.json` fields.
- When the plugin has its own `plugin.json`, the entry's `mcpServers`, `lspServers`, `userConfig`, and `channels`
  **don't apply**.

Source: [marketplace-reference](https://code.claude.com/docs/en/plugins/marketplace-reference#top-level-fields).

**Plugin sources:**

| Source | Form |
| :- | :- |
| Relative path | `./plugins/x`, or `./` for the repo root |
| GitHub | `github` with `repo`, `ref`, and `sha` |
| Any git URL | `url`, for example `https://gitlab.example.com/group/x.git` |
| Subdirectory of a repo | `git-subdir` |
| npm package | `npm` |
| Zip over HTTPS | `archive`, with an optional `sha256` |
| Command output | `command`: a directory that a command prints on the user's machine, after the user accepts it |

Source: [marketplace-reference: plugin sources](https://code.claude.com/docs/en/plugins/marketplace-reference#plugin-sources).

**Publishing from the plugin's own repo.** Put `marketplace.json` beside `plugin.json`, with one entry whose
`"source": "./"` [[publish](https://code.claude.com/docs/en/plugins/publish#add-the-marketplace-file-to-your-repository)].
mattpocock/skills does exactly this.

**Hosting on GitLab.** Users run `/plugin marketplace add https://gitlab.example.com/team/plugins.git`, with the full
URL; `owner/repo` shorthand always means github.com. Cloning uses the user's existing git credentials and never
prompts. A `GITHUB_TOKEN` or another provider token in the environment doesn't help unless a credential helper reads
it.
[[host-marketplace](https://code.claude.com/docs/en/plugins/host-marketplace#host-your-marketplace),
[private marketplaces](https://code.claude.com/docs/en/plugins/host-marketplace#grant-access-to-a-private-marketplace)]

**Installing.**

- `claude plugin marketplace add <source>`, then `claude plugin install <plugin>@<mkt> [--scope user|project|local]`.
  The two combine as `claude plugin install <plugin> --marketplace <source>` (≥ 2.1.292).
- In a session, `/plugin install …` opens a details pane that lists what the plugin will install, then asks for a
  scope.
- The scopes write `enabledPlugins` to `~/.claude/settings.json`, `.claude/settings.json`, or
  `.claude/settings.local.json`. A more specific scope overrides a less specific one: local over project over user.

Source: [install](https://code.claude.com/docs/en/plugins/install#install-a-plugin).

**Requiring a plugin from a repository.** A repo's `.claude/settings.json` can carry `extraKnownMarketplaces` and
`enabledPlugins`.

- Claude Code registers the marketplace only after the user accepts workspace trust.
- A plugin with a relative-path source then loads from the marketplace copy.
- A plugin with an external source isn't installed for collaborators. Each one sees "enabled in project settings but
  isn't installed" until they run `claude plugin install … --scope project`.

Source: [org](https://code.claude.com/docs/en/plugins/org#require-plugins-per-repository),
[settings-reference](https://code.claude.com/docs/en/settings-reference#extraknownmarketplaces),
[loading](https://code.claude.com/docs/en/plugins/loading#enabled-in-project-settings-but-not-installed).

**Organization-wide.** Managed settings, either server-managed from the claude.ai admin console or delivered by MDM or
a file, can force-enable plugins and allowlist or block marketplaces. A Team or Enterprise organization can also sync
a private or internal gitlab.com repository through its claude.ai GitLab connection. Plugins with a top-level `bin/`
are rejected there.
[[org](https://code.claude.com/docs/en/plugins/org#require-a-marketplace-and-its-plugins),
[host-marketplace](https://code.claude.com/docs/en/plugins/host-marketplace#distribute-through-organization-settings)]

**Anthropic's directory.** Submission needs a paid claude.ai plan. A listed plugin reaches Claude Code as
`<name>@synced` for people who add it on claude.ai. The official `claude-plugins-official` marketplace doesn't take
submissions through the portal.
[[publish](https://code.claude.com/docs/en/plugins/publish#submit-to-anthropics-directory)]

**Without a marketplace.**

- `--plugin-dir <dir|zip>` or `--plugin-url <zip>` load a plugin for one session.
- `CLAUDE_CODE_PLUGIN_DIRS` does the same through an environment variable (≥ 2.1.280).
- A plugin directory placed under `~/.claude/skills/<name>/` loads every session as `<name>@skills-dir`.
- A plugin under a project's `.claude/skills/<name>/` also loads as `@skills-dir`, after trust, and only from the
  primary working directory.

Source: [create](https://code.claude.com/docs/en/plugins/create#develop-without-a-marketplace),
[loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository).

**Versions and updates.**

- **How the version is computed:** the manifest `version` wins, then the entry's `version`, then the commit SHA (for
  git sources). A pinned `version` means users don't get new commits until the string changes.
- **Auto-update:** on by default for Anthropic's official marketplaces, off for third-party ones. A user or a managed
  `autoUpdate: true` turns it on.
- **Manual update:** `claude plugin update <p>@<m>`, or **Update now** in `/plugin`.
- **After an update:** the session keeps the old version until `/reload-plugins`. Old version directories are removed
  14 days later.

Source: [loading](https://code.claude.com/docs/en/plugins/loading#versions-and-updates),
[install](https://code.claude.com/docs/en/plugins/install#keep-plugins-updated).

### 10. Cloud sessions (Claude Code on the web)

| In a cloud session | Loads? | Source |
| :- | :- | :- |
| `/plugin` command and plugin browser | No | [claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web#manage-context), [install](https://code.claude.com/docs/en/plugins/install#install-a-plugin) |
| Plugins enabled in your own user settings | No | [cloud-environments](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup) |
| Plugins and marketplaces declared in the repo's `.claude/settings.json` | No. Repo `extraKnownMarketplaces` needs the trust dialog, which a cloud session never shows | [cloud-environments](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup), [loading](https://code.claude.com/docs/en/plugins/loading#plugins-shared-through-a-repository) |
| Plugins in the org's **server-managed** settings (`extraKnownMarketplaces` and `enabledPlugins`) | Yes. The session waits for them before installing plugins. Anthropic-hosted environments only; MDM and file-based policy don't reach them | [org](https://code.claude.com/docs/en/plugins/org#when-each-surface-applies-the-plugin-keys) |
| Repo `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `CLAUDE.md`, and `.claude/rules/` | Yes, as part of the clone | [cloud-environments](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup) |
| Repo `.mcp.json` servers, hooks, and permission rules | Yes, in a session with one repository. Project `.mcp.json` servers connect without an approval prompt | [cloud-environments](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup), [mcp](https://code.claude.com/docs/en/mcp#project-scope) |
| Skills enabled on your claude.ai account | Yes | [skills](https://code.claude.com/docs/en/skills#skills-in-cowork-and-cloud-sessions) |
| claude.ai connectors (remote MCP added in claude.ai) | Yes, passed in by the cloud host. Connector traffic bypasses the session's network allowlist | [mcp](https://code.claude.com/docs/en/mcp#how-connectors-reach-claude-code), [cloud-environments](https://code.claude.com/docs/en/cloud-environments#network-access) |

**Secrets in a cloud session.**

- **Environment variables:** these are set on the cloud environment and readable by anyone who uses the environment.
- **Network secrets:** Pro and Max only, not yet on Team or Enterprise. The agent proxy adds a header, by default
  `Authorization: Bearer <value>`, to requests for the hosts you list, so the token never enters the VM. A network
  secret is never attached to requests from the setup script.
- `userConfig` can't be set there. There is no `/plugin`, and `pluginConfigs` is read only from user or managed
  settings.

Source: [cloud-environments: environment variables](https://code.claude.com/docs/en/cloud-environments#set-environment-variables),
[network secrets](https://code.claude.com/docs/en/cloud-environments#add-network-secrets).

**Network access.** The default Trusted level includes `gitlab.com`, `www.gitlab.com`, and `registry.gitlab.com`. A
self-managed Instance needs a **Custom** allowlist entry. The hosts of a network secret are reachable regardless of
the allowlist.
[[cloud-environments](https://code.claude.com/docs/en/cloud-environments#default-allowed-domains)]

**Setup scripts and hooks.** A setup script runs as root before Claude Code starts, and its result is cached. A
`SessionStart` hook can detect the cloud through `CLAUDE_CODE_REMOTE=true`.
[[cloud-environments](https://code.claude.com/docs/en/cloud-environments#setup-scripts),
[env-vars](https://code.claude.com/docs/en/env-vars)]

**Observed in this cloud container.**

- `claude plugin list`, run in a new, untrusted scratch project, skipped a project `.claude/skills/<plugin>/` plugin
  with "skipped because this workspace was not trusted".
- `~/.claude/plugins/synced/` exists but is empty.

Neither observation shows what the claude.ai/code session runtime itself loads; see [Unverified](#unverified).

### 11. Reference plugins compared

**[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)** at `f359d43`:

- **`external_plugins/gitlab`:** GitLab's listed plugin is just `plugin.json` (`name`, `description`, `author`) plus
  this `.mcp.json`:

  ```json
  { "gitlab": { "type": "http", "url": "https://gitlab.com/api/v4/mcp" } }
  ```

  It has no skills, no `userConfig`, and a hard-coded gitlab.com URL, so it relies on OAuth and doesn't cover
  self-managed Instances.
- **`external_plugins/github`:** it uses env expansion for a PAT:
  `"headers": {"Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}"}`.
- **`external_plugins/telegram` and `discord`:** they bundle stdio servers launched as
  `bun run --cwd ${CLAUDE_PLUGIN_ROOT} …`.
- **`plugins/code-modernization`:** it shows `userConfig` with defaults, `options` pickers, and booleans.
- **`plugins/example-plugin`:** it has two skills (one user-invoked, with `argument-hint` and `allowed-tools`), a
  legacy `commands/` file, and a remote MCP server.

**[anthropics/claude-code](https://github.com/anthropics/claude-code/tree/main/plugins)** at `bf2323b`: the
`claude-code-plugins` demo marketplace, using relative-path entries under `plugins/`.

**[mattpocock/skills](https://github.com/mattpocock/skills)** at `49dd158` is the upstream of this repo's
`.claude/skills/`.

- Its `plugin.json` lists 27 skill directories under `skills`, each holding `SKILL.md` directly.
- `marketplace.json` sits in the same repo with `"source": "./"`.
- This repo vendors those skills as plain project skills, not as a plugin. They therefore run as `/tdd` rather than
  `/mattpocock-skills:tdd`, and they load in cloud sessions because they're part of the clone, which matches the
  vendoring note in `.claude/skills/README-mattpocock-skills.md`.

### 12. Minimal example layout

The example has an MCP server, two skills, and a slash command. It is the doc version of what I validated locally:
`claude plugin validate --strict` passed for the plugin directory and for the directory with `marketplace.json`
added, and `claude plugin details` reported `Skills (3)` and `MCP servers (1) gitlab`.

```text
gitlab-work-items/                  # repo root = plugin root = marketplace root
├── .claude-plugin/
│   ├── plugin.json                 # manifest + userConfig
│   └── marketplace.json            # optional: makes the repo installable by name
├── .mcp.json                       # the bundled MCP server
├── server/
│   └── index.js                    # stdio MCP server (with package.json + lockfile if it has deps)
├── skills/
│   ├── review-work-item/SKILL.md   # /gitlab-work-items:review-work-item  (user or Claude)
│   └── comment-on-work-item/SKILL.md
└── commands/
    └── create-work-item.md         # /gitlab-work-items:create-work-item  (user only)
```

`.claude-plugin/plugin.json`:

```json
{
  "name": "gitlab-work-items",
  "version": "0.1.0",
  "description": "Review, edit, comment on, and create GitLab Issues, Tasks, and Epics",
  "author": { "name": "Example Author" },
  "license": "MIT",
  "userConfig": {
    "gitlab_host": {
      "type": "string",
      "title": "GitLab Instance host",
      "description": "Host of your GitLab Instance, such as gitlab.com or gitlab.example.com",
      "default": "gitlab.com"
    },
    "gitlab_token": {
      "type": "string",
      "title": "GitLab personal access token",
      "description": "PAT with the api scope. Leave empty to fall back to GITLAB_TOKEN or your glab login.",
      "sensitive": true
    }
  }
}
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/index.js"],
      "env": {
        "GITLAB_HOST": "${user_config.gitlab_host}",
        "GITLAB_PLUGIN_TOKEN": "${user_config.gitlab_token}"
      }
    }
  }
}
```

The server would use `GITLAB_PLUGIN_TOKEN` when it's non-empty, then the inherited `GITLAB_TOKEN`, then `glab`'s
stored login. The variable is named `GITLAB_PLUGIN_TOKEN` so that an empty `userConfig` value doesn't shadow the
user's own `GITLAB_TOKEN`.

`skills/review-work-item/SKILL.md`:

```markdown
---
description: Review a GitLab Work Item (Issue, Task, or Epic) for clarity, completeness, and gaps. Use when the user asks to review a GitLab issue, task, or epic, or pastes a Work Item URL.
argument-hint: <work-item URL or reference>
allowed-tools: mcp__plugin_gitlab-work-items_gitlab__get_work_item mcp__plugin_gitlab-work-items_gitlab__list_threads
---

Review the Work Item $ARGUMENTS. Read its description, Threads, Hierarchy, and Linked Items
with the `gitlab` MCP tools, then report gaps in clarity and completeness.
```

`skills/comment-on-work-item/SKILL.md`:

```markdown
---
description: Post a Comment on a GitLab Work Item, reply in a Thread, or resolve a Thread. Use when the user asks to comment on, reply to, or resolve a discussion on a GitLab issue, task, or epic.
argument-hint: <work-item reference> [comment text]
---

Draft the Comment for $ARGUMENTS, show it to the user, and post it with the `gitlab` MCP tools
only after the user confirms. To resolve a Thread, name the Thread you are resolving.
```

The comment skill sets no `allowed-tools`, so every write goes through a permission prompt.

`commands/create-work-item.md`:

```markdown
---
description: Create a GitLab Issue, Task, or Epic
argument-hint: <issue|task|epic> <project-or-group path> [title]
disable-model-invocation: true
---

Create a $0 in $1 titled "$2". Ask for anything missing, show the draft, and create it with
the `gitlab` MCP tools only after the user confirms.
```

For new plugins the docs prefer `skills/create-work-item/SKILL.md` with the same frontmatter; it behaves the same.
The MCP tool names in `allowed-tools` (`get_work_item`, `list_threads`) are placeholders for whatever the server
exposes.

`.claude-plugin/marketplace.json`, optional:

```json
{
  "name": "gitlab-work-items",
  "description": "GitLab Work Items plugin for Claude Code",
  "owner": { "name": "Example Author" },
  "plugins": [{ "name": "gitlab-work-items", "source": "./" }]
}
```

Users would then run:

```bash
claude plugin marketplace add https://gitlab.com/<group>/gitlab-work-items.git
claude plugin install gitlab-work-items@gitlab-work-items --config gitlab_host=gitlab.example.com
```

Interactive users get the masked token prompt from `/plugin configure gitlab-work-items@gitlab-work-items`.

### 13. Implications for the spec

These are my inferences, not documented facts.

- **Server shape:**
  - A bundled stdio server, a Node script with a lockfile or a single binary, fits every Claude Code surface except
    claude.ai chat.
  - It takes the Instance host and token from `userConfig` and falls back to `GITLAB_TOKEN` and then `glab` inside the
    server.
  - It avoids `headersHelper`, whose environment has tokens stripped.
- **GitLab's remote MCP endpoint:** using it with a PAT means setting an `Authorization` header, and a header disables
  the OAuth fallback, so one entry can't do "PAT if set, else OAuth". The official `gitlab` plugin covers only the
  OAuth case, and only for gitlab.com.
- **Write actions:** make them confirm-before-write. Don't pre-approve write tools in `allowed-tools`. Consider
  `disable-model-invocation: true` for creation, and `requiresUserInteraction` on destructive tools.
- **Cloud sessions:** the documented ways in are server-managed settings or committing skills and a `.mcp.json` to
  the repo being worked on. The token arrives through an environment variable or a network secret, and a self-managed
  Instance also needs a Custom network allowlist entry. Tickets 09 and 10 should decide whether cloud support is a v1
  goal.

## Unverified

- **Plugins in a claude.ai/code session.** I couldn't confirm whether any of these load in a real cloud session:
  - a project `@skills-dir` plugin, meaning a plugin directory committed under `.claude/skills/`;
  - a `CLAUDE_CODE_PLUGIN_DIRS` path set as a cloud environment variable;
  - a plugin installed by a cloud setup script that runs `claude plugin install`.

  The docs don't say. The local CLI in this container skipped the `@skills-dir` plugin as untrusted, but the session
  runtime may treat trust differently, since repo permission rules do apply in cloud sessions.
- **Synced plugins in cloud sessions.** Whether claude.ai-synced (`@synced`) plugins load in cloud sessions is
  unconfirmed. The docs name only terminal and Cowork sessions, and claude.com's support table defines "Claude Code"
  as the terminal, the IDE extensions, and the desktop Code tab.
- **Credential variables in remote `url`/`headers`.** The docs list examples, not the full set of variables read as
  empty. `GITLAB_TOKEN` wasn't blanked in 2.1.296, which may change.
- **Credential variables in a stdio server's environment.** Whether Claude Code ever strips credential-named variables
  from a plugin stdio server's environment is undocumented; they weren't stripped in 2.1.296. The documented stripping
  covers only `headersHelper`.
- **Default prompt for plugin MCP tools.** I didn't find a statement of whether a plugin MCP tool prompts on first use
  in default mode. The docs say only that permission rules apply to MCP tool calls.
- **Empty `Authorization` header.** I didn't test whether an empty header such as `Bearer ` (from an empty variable)
  still disables the OAuth fallback.
- **macOS Keychain storage.** This comes from the docs only. The local check exercised the Linux fallback file.
- **`npx` and `uvx` runtimes.** Whether they must already be on the user's `PATH` for a plugin stdio server is
  inferred from the general MCP docs, not stated for plugins.
- **Network secrets for GitLab.** These rely on GitLab accepting a PAT as `Authorization: Bearer`. That's a GitLab-side
  fact for ticket 01, not checked here.

## Sources

Claude Code docs, all fetched 2026-10-13:

- Plugins: [overview](https://code.claude.com/docs/en/plugins/overview),
  [components](https://code.claude.com/docs/en/plugins/components),
  [manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference),
  [create](https://code.claude.com/docs/en/plugins/create),
  [install](https://code.claude.com/docs/en/plugins/install),
  [loading](https://code.claude.com/docs/en/plugins/loading),
  [security](https://code.claude.com/docs/en/plugins/security),
  [publish](https://code.claude.com/docs/en/plugins/publish),
  [org](https://code.claude.com/docs/en/plugins/org),
  [CLI reference](https://code.claude.com/docs/en/plugins/cli-reference),
  [mods overview](https://code.claude.com/docs/en/plugins/mods/overview).
- Marketplaces: [create marketplace](https://code.claude.com/docs/en/plugins/create-marketplace),
  [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference),
  [host marketplace](https://code.claude.com/docs/en/plugins/host-marketplace).
- Core features: [skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp),
  [permissions](https://code.claude.com/docs/en/permissions).
- Settings: [settings](https://code.claude.com/docs/en/settings),
  [settings reference](https://code.claude.com/docs/en/settings-reference),
  [environment variables](https://code.claude.com/docs/en/env-vars).
- Cloud: [cloud environments](https://code.claude.com/docs/en/cloud-environments),
  [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web).
- [Plugin feature support across platforms](https://claude.com/docs/plugins/platform-support) (claude.com)

Repositories:

- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) @ `f359d43`:
  `external_plugins/gitlab`, `external_plugins/github`, `external_plugins/telegram`, `plugins/example-plugin`,
  `plugins/code-modernization`, `.claude-plugin/marketplace.json`
- [anthropics/claude-code](https://github.com/anthropics/claude-code) @ `bf2323b`: `plugins/README.md`,
  `.claude-plugin/marketplace.json`
- [mattpocock/skills](https://github.com/mattpocock/skills) @ `49dd158`: `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`

Local checks: Claude Code CLI 2.1.296. The commands used were `claude plugin validate`, `claude plugin details`,
`claude mcp list` with a probe stdio server and a localhost header logger, and `claude plugin install --config` into
an isolated `CLAUDE_CONFIG_DIR`. The probe files lived in a scratch directory outside this repo.
