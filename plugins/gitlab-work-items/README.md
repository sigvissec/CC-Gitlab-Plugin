# GitLab Work Items for Claude Code

Brings GitLab Issues and Tasks into Claude Code. Paste a Work Item's URL or Reference, or ask about your work, and Claude fetches it live, with its Threads, parent and children, Linked Items, and the merge requests that close or mention it. Claude can then edit it, comment, reply to and resolve Threads, and create Issues and Tasks. Every Write is previewed first and happens only when you confirm it.

## Requirements

- Linux, with Claude Code on your own machine: the `claude` command in a terminal, the VS Code or JetBrains extension, or the Claude desktop app (in beta on Linux, for Ubuntu 22.04 or later and Debian 12 or later). Windows and macOS aren't supported. Claude Code on the web doesn't load plugins installed on your machine.
- [`glab`](https://gitlab.com/gitlab-org/cli) 1.123.0 or later, and Node 20 or later, on your `PATH`.
- GitLab 18.1 or later: gitlab.com or a self-managed Instance, CE or EE, any tier. Weight needs EE on Premium; "blocks" links need Premium.

## Install

```sh
claude plugin marketplace add sigvissec/CC-Gitlab-Plugin
claude plugin install gitlab-work-items@gitlab-work-items --config instance_url=https://gitlab.example.com
```

`claude plugin install` doesn't prompt for the other options; set them as below, or with `/plugin configure gitlab-work-items@gitlab-work-items` in a session.

Releases pin their version; update deliberately with `claude plugin update gitlab-work-items@gitlab-work-items`.

## Sign in

Pick one:

1. **Your glab login** (recommended): `glab auth login --hostname gitlab.example.com`. glab keeps the token in your desktop's keyring, such as GNOME Keyring or KDE Wallet, when one is running, and in its config file otherwise. glab knows an Instance by its bare hostname, so an Instance on a port or under a sub-path takes two extra settings. For `http://example.com:8080/gitlab`:

   ```sh
   glab config set subfolder gitlab --host example.com
   glab auth login --hostname example.com --api-host example.com:8080 --api-protocol http
   ```

   Sign in to such an Instance with a token (glab asks for one, or pass `--stdin`), not through the browser: glab's browser sign-in always uses https and ignores `--api-host`. The plugin itself always uses the address in its `instance_url` setting.
2. **A token in the plugin's settings**: run `/plugin configure gitlab-work-items@gitlab-work-items` in a session, or open `/plugin`, choose gitlab-work-items, and set the token option. On Linux, Claude Code keeps it unencrypted in `~/.claude/.credentials.json`, which only you can read; glab's login is the safer choice where you have a keyring. Use a personal access token with the `api` scope (`read_api` if you only want to read; Writes then fail when sent).

The plugin uses its own setting first, then glab's login for the configured Instance, then `GITLAB_TOKEN`. `GITLAB_TOKEN` works only when Claude Code was started with it in its environment, as when you run `claude` from a shell that exports it. Token and other credential variables the plugin didn't choose are never passed to glab, so a token meant for another GitLab, or a CI job token, isn't sent to yours.

Then check everything: `/gitlab-work-items:status acme/app` shows the Instance, token source, versions, and runs read-only probes in that project.

## Use

Talk normally: "what's left on acme/app#12?", "list open issues in acme labelled auth", "relabel those three as blocked". Short references like `#12` are resolved against the project you're discussing or your repo's git remote, and Claude says which it used.

Lists are short, numbered summaries. To read one in Claude Code, say its number, reference, or title ("open 3"): Claude shows it in full, with its fields, description, and every Comment. To choose from a list with the arrow keys instead, use `/gitlab-work-items:open`. Links in Claude's answers open GitLab in your browser instead, because Claude Code hands a clicked link to your system's browser.

If you plan with the wayfinder skill on GitLab, starting Claude Code in a repo whose project is on your Instance lists the wayfinder tickets you've claimed there: the open ones labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` and assigned to you, each with its map. Say a number to open one, or pick one with `/gitlab-work-items:open`. The project comes from the repo's `origin` remote, or its only other remote on your Instance. This costs one GitLab lookup as a session starts; outside such a repo it does nothing, and with no claimed tickets it shows nothing.

Commands, to drive the plugin directly:

| Command | Does |
|---|---|
| `/gitlab-work-items:fetch <reference>` | Fetch one Work Item and show it in full: its fields, description, and every Comment |
| `/gitlab-work-items:list <what you want>` | A filtered list, described in plain words |
| `/gitlab-work-items:mine` | Your open Work Items across the Instance |
| `/gitlab-work-items:comment <reference> <what to say>` | Comment, or reply in a Thread when given a Comment link; quoted text is posted word for word, except lines GitLab runs as quick actions (such as `/close`), which the preview points out |
| `/gitlab-work-items:open [what to pick from]` | Pick a Work Item from a list in a dialog and see it in full; with nothing given, from your claimed wayfinder tickets in this repo's project |
| `/gitlab-work-items:status [project]` | Setup check, plus read-only probes in a project |

## How Writes stay safe

- Every Write is previewed first: fields as before → after, descriptions as a diff, Comments exactly as they'll appear. Lines GitLab would run as quick actions (such as `/close`) are pointed out.
- Only you can confirm. Claude Code asks you to approve applying Writes every time, even if you once chose "always allow" or use a mode that skips prompts, and the plugin then asks you in a dialog of its own: tick "Apply to GitLab", then Accept. In the terminal that dialog shows only the start of the preview (the first lines of a lone Write, or each Write's first line), so read the full preview Claude shows you before confirming. The dialog waits up to an hour. Where no dialog can be shown, as in `claude -p`, nothing is sent. Reading never prompts.
- Before sending, the plugin checks your token's permissions and that the Work Item (or Thread) hasn't changed since it was fetched. After sending, it re-reads and tells you about anything GitLab didn't keep, such as a second assignee on Free.
- The plugin never deletes anything. One preview holds at most 20 Writes.
- Comments are public unless you ask for internal. Comments, replies, and new Work Items carry a "_Posted with Claude Code_" footer; turn it off with the footer option.

## Not verified yet

These behaviours couldn't be checked when the plugin was built, so watch for them:

- **The desktop app's Linux beta and the IDE extensions:** whether the confirmation and pick-list dialogs render there (if the confirmation doesn't, nothing is sent), and whether the desktop app finds `glab` on your `PATH` when started from your application launcher.
- **Premium and your own Instance:** reads were checked against gitlab.com, and every Write runs in CI against throwaway Instances (GitLab 18.1 and the newest release, each as EE and CE, all on Free). Premium-only Writes (weight, "blocks" links) haven't run against real GitLab yet. Before relying on Writes, try them on a scratch project on your Instance:
  1. `/gitlab-work-items:status <project>`: every probe passes.
  2. Fetch an Issue, then ask Claude to retitle it, add a label, and set a due date. Confirm, and check the result in GitLab.
  3. Ask Claude to start a Thread on it, then to reply in that Thread by the link to its first Comment, then to resolve the Thread.
  4. Create a Task under the Issue.
  5. Prepare an Edit, change the Issue in GitLab's own UI, then confirm: the Edit is held back and Claude shows what changed.

## Not in scope

Epics and other Work Item Types, merge requests themselves (only those linked to a Work Item are shown), deleting anything, editing posted Comments, images and attachments beyond their links, custom fields, bulk changes beyond 20 Writes, searching Comments, and several Instances at once.
