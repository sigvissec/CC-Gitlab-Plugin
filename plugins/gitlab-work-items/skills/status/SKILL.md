---
name: status
description: Check the GitLab plugin's setup, and optionally probe a project
argument-hint: "[project path to probe, e.g. acme/app]"
disable-model-invocation: true
---

Call the `status` tool (pass the project below, if one is given, to run its read-only probes) and report the result. For anything not met, give the user the fix:

- glab missing or too old: install or upgrade glab (https://gitlab.com/gitlab-org/cli).
- No token: run `glab auth login --hostname <Instance>` in a terminal, or enter a token in the plugin's settings (`/plugin`, then the gitlab-work-items plugin's options).
- Wrong Instance: change the Instance URL in the plugin's settings.
- GitLab older than 18.1: the plugin can't work with this Instance.

$ARGUMENTS
