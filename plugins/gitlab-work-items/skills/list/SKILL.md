---
name: list
description: List GitLab Work Items matching a description in plain words
argument-hint: <what you want, e.g. open issues in acme/app labelled auth>
disable-model-invocation: true
---

Load the `gitlab-work-items:work-items` skill if it isn't loaded, then list the Work Items described here, saying how you read the request: $ARGUMENTS
