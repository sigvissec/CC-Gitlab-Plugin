---
name: status
description: Check the GitLab plugin's setup, and probe a project
argument-hint: "[project path to probe, e.g. acme/app]"
disable-model-invocation: true
---

Load the `gitlab-work-items:work-items` skill if it isn't loaded, then call the `status` tool and report the result. Run its read-only probes in the project named below, or else in the project the skill's Context rules give; say which project you used.

For anything not met, give the user the fix the result names; it includes the exact sign-in command for their Instance:

- glab missing or too old: install or upgrade glab (https://gitlab.com/gitlab-org/cli).
- No token: run the sign-in command from the result in a terminal, or enter a token in the plugin's settings (`/plugin`, then the gitlab-work-items plugin's options).
- Wrong Instance: change the Instance URL in the plugin's settings.
- GitLab older than the plugin supports: the plugin can't work with this Instance.

$ARGUMENTS
