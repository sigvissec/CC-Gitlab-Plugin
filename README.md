# CC-Gitlab-Plugin

Development home of [`gitlab-work-items`](plugins/gitlab-work-items/README.md), a Claude Code plugin for GitLab Issues and Tasks. This repository is also the plugin's marketplace.

## Layout

| Path | What |
|---|---|
| `plugins/gitlab-work-items/` | The plugin as installed: manifest, MCP config, hook config, skills, and the bundled server and hooks |
| `src/server/` | The MCP server's source (TypeScript), bundled into `plugins/gitlab-work-items/server/` |
| `src/hook/` | The hooks' source (the write-guard and session-start hooks), bundled into `plugins/gitlab-work-items/hooks/` |
| `src/tool-names.ts` | The MCP tools' names, and which read or write, shared by the server and the hook |
| `test/` | Tests that drive the bundled server over stdio and run the bundled hooks, with a fake `glab` replaying cassettes |
| `test/recordings/` | Responses recorded from real GitLab; a changed query fails until re-recorded |
| `.scratch/gitlab-work-items-plugin/` | The planning map, its decision tickets, and the [spec](.scratch/gitlab-work-items-plugin/spec.md) |
| `GLOSSARY.md` | The domain vocabulary used throughout |

## Develop

```sh
npm install
npm run typecheck
npm test          # builds the bundles, then runs every test
```

The bundles in `plugins/gitlab-work-items/` are committed, so installing the plugin downloads nothing. Run `npm run build` and commit them with any source change.

To release, raise `version` in `plugins/gitlab-work-items/.claude-plugin/plugin.json`; the server reports the same version, read from there at build time. Installed copies stay on the version they have until it changes, whatever is committed after it.

Tests sit at two seams: the MCP server's tool interface (the tests are an MCP client; GitLab sits behind whatever `glab` is first on `PATH`), and the hooks' input and output.
