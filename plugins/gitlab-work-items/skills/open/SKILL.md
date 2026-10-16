---
name: open
description: Pick a GitLab Work Item from a list and see it in full
argument-hint: "[what to pick from, e.g. open issues in acme/app; default: your claimed wayfinder tickets here]"
disable-model-invocation: true
---

Load the `gitlab-work-items:work-items` skill if it isn't loaded, then let the user pick a Work Item with `pick_work_item` and show the one they pick in full. Pick from: $ARGUMENTS

With nothing given, pick from the wayfinder tickets the user has claimed in this repo's project.
