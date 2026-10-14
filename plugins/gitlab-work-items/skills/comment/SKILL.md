---
name: comment
description: Comment on a GitLab Work Item, or reply in a Thread, after a preview
argument-hint: <reference or Comment link> <"exact text" or what to say>
disable-model-invocation: true
---

Load the `gitlab-work-items:work-items` skill if it isn't loaded, then post the Comment described below through its Writes loop.

- The first argument is the Reference. A Comment link makes this a reply in that Comment's Thread.
- Text in quotes is posted word for word. Anything else describes what to say: draft it, and the preview lets the user check your wording.

$ARGUMENTS
