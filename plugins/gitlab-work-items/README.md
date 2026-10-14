# GitLab Work Items for Claude Code

Brings GitLab Issues and Tasks into Claude Code. Paste a Work Item link or ask about your work, and Claude fetches it live, with its Threads, parent and children, Linked Items, and the merge requests that close or mention it. Claude can then edit it, comment, reply to and resolve Threads, and create Issues and Tasks. Every change is previewed first and happens only when you confirm it.

## Requirements

- Claude Code on your own machine: the desktop app, the `claude` command in a terminal, or the VS Code or JetBrains extension. Claude Code on the web isn't supported.
- [`glab`](https://gitlab.com/gitlab-org/cli) 1.123.0 or later, and Node 20 or later, on your `PATH`.
- GitLab 18.1 or later: gitlab.com or a self-managed Instance, CE or EE, any tier. Weight needs EE on Premium; "blocks" links need Premium.

## Install

```sh
claude plugin marketplace add sigvissec/CC-Gitlab-Plugin
claude plugin install gitlab-work-items@gitlab-work-items --config instance_url=https://gitlab.example.com
```

Releases pin their version; update deliberately with `claude plugin update gitlab-work-items@gitlab-work-items`.

## Sign in

Pick one:

1. **Your glab login** (recommended): `glab auth login --hostname gitlab.example.com`. For an Instance under a sub-path, use the host and path, for example `example.com/gitlab`.
2. **A token in the plugin's settings**: open `/plugin`, choose gitlab-work-items, and set the token option, or run `claude plugin configure gitlab-work-items@gitlab-work-items`. It's stored in your system keychain. Use a personal access token with the `api` scope (`read_api` if you only want to read).

The plugin uses its own setting first, then glab's login for the configured Instance, then `GITLAB_TOKEN`. `GITLAB_TOKEN` works when it reaches the plugin (for example in a terminal session), but on macOS the desktop app doesn't pass on variables exported in your shell profile. Token variables the plugin didn't choose are never passed to glab, so a token meant for another GitLab isn't sent to yours.

Then check everything: `/gitlab-work-items:status acme/app` shows the Instance, token source, versions, and runs read-only probes in that project.

## Use

Talk normally: "what's left on acme/app#12?", "list open issues in acme labelled auth", "relabel those three as blocked". Short references like `#12` are resolved against the project you're discussing or your repo's git remote, and Claude says which it used.

Commands, for shortcuts:

| Command | Does |
|---|---|
| `/gitlab-work-items:fetch <reference>` | Fetch one Work Item and show its digest |
| `/gitlab-work-items:list <what you want>` | A filtered list, described in plain words |
| `/gitlab-work-items:mine` | Your open Work Items across the Instance |
| `/gitlab-work-items:comment <reference> <what to say>` | Comment, or reply in a Thread when given a Comment link; quoted text is posted word for word |
| `/gitlab-work-items:status [project]` | Setup check, plus read-only probes in a project |

## How Writes stay safe

- Every Write is previewed first: fields as before → after, descriptions as a diff, Comments exactly as they'll appear.
- Only you can confirm. Where Claude Code supports it, the plugin asks you directly in a dialog; elsewhere Claude Code's approval prompt for applying Writes appears every time, even if you once chose "always allow". Reading never prompts.
- Before sending, the plugin checks your token's permissions and that the Work Item (or Thread) hasn't changed since it was fetched. After sending, it re-reads and tells you about anything GitLab didn't keep, such as a second assignee on Free.
- The plugin never deletes anything. One preview holds at most 20 Writes.
- Comments are public unless you ask for internal. Comments, replies, and new Work Items carry a "_Posted with Claude Code_" footer; turn it off with the footer option.

## Not verified yet

These behaviours couldn't be checked when the plugin was built, so watch for them:

- **Desktop app and IDE extensions:** whether the settings prompt appears after install, whether the confirmation dialog renders (if it doesn't, Claude Code's approval prompt still guards every Write), and whether the plugin finds `glab` and your token when the desktop app is launched from the Dock on macOS.
- **Real GitLab Instances:** reads were checked against gitlab.com; Writes have so far only been exercised against recorded responses. Sub-path Instances depend on glab accepting `host/path` as the hostname.

## Not in scope

Epics and other Work Item Types, merge requests themselves (only those linked to a Work Item are shown), deleting anything, editing posted Comments, images and attachments beyond their links, custom fields, bulk changes beyond 20 Writes, searching Comments, and several Instances at once.
