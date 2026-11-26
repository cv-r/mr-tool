# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension (TypeScript) that creates a GitLab MR / GitHub PR from a graphical webview panel. Root `mr.cjs` is the original CLI version, kept for reference and standalone use.

## Commands

```bash
npm install          # install dev dependencies
npm run compile      # tsc -> dist/
npm run watch        # tsc watch
npm run package      # build a .vsix with vsce

# publish to the Marketplace (needs VSCE_PAT; see scripts/publish.sh)
npm run publish:marketplace
./scripts/publish.sh patch   # bump version, then publish
```

Press `F5` in VS Code to launch the Extension Development Host (`.vscode/launch.json` compiles first). There is no test suite and no lint setup.

## Architecture

The extension operates on whichever Git repo the workspace points at, not on this directory.

```
extension.ts
  registers commands and three tree views: mrTool.myMrs / myReviews / myCreated
  opens/reveals the singleton MrPanel and the MR edit panel; initializes the status bar

repo.ts
  resolveRepoRoot() uses the built-in vscode.git API (falls back to workspace folders)
  resolveRepoContext() returns repo root + remote + PlatformProvider

MrPanel (webview/panel.ts)
  owns the WebviewPanel, HTML, CSP, and the message protocol (webview/protocol.ts)
  sends: context / existing / diff / members / progress / log / result / errors
  receives: ready, refresh, searchMembers, checkExisting, loadDiff, create,
            openExternal, copy, switchBranch, openSettings

MrService (mrService.ts)
  loadContext(): repo check, remote parse, platform detection, fetch, branch list,
                 default target, existing-MR check, current user,
                 default assignees/reviewers, MR templates
  create(): pushes the branch, aborts if the push fails and the remote is stale,
            then delegates to the platform provider

myMrs.ts
  TreeDataProvider shared by all three views; mode = assigned | review | created
  refresh -> provider.listAssignedMrs() / listReviewMrs() / listCreatedMrs()
  merge/approve/markReady/close/checkout delegate to the provider
  icons surface conflicts, CI failures, running checks and review state

webview/editPanel.ts
  standalone webview to edit an existing MR title/description
  getMrContent() -> user edits -> editMr(); only exposed on the created view

mrTemplates.ts
  reads .gitlab/merge_request_templates/**/*.md and GitHub PR template files

statusBar.ts
  status bar item shows the current branch's MR; click opens it (or the create panel)

notify/feishu.ts
  Feishu bot webhook sender (mrTool.feishuWebhook)
  create/merge/manual have separate prefixes (feishu*Prefix, falling back to feishuPrefix)
  create/merge bodies come from feishu*Template with {project}/{title}/{url}/... placeholders
  feishuMentions renders `<at user_id="ou_xxx">` / "all" tags, appended unless template has {mentions}
  notifyMrCreated() called from MrPanel.onCreate, notifyMrMerged() from extension.mergeMr
  manual command mrTool.sendFeishu prompts for text; failures never block MR creation

Git (git.ts)
  spawn-based git wrapper; parseRemote() handles https, ssh://, and git@host:path
  diffInfo(source, target), resolveRef() prefers local refs then origin/<name>

platforms/
  index.ts   chooses GitLab vs GitHub from config, host name, and installed/logged-in CLIs
  gitlab.ts  glab mr create -> glab api -> curl (GITLAB_TOKEN) -> prefilled web URL
             listAssignedMrs(): scope=assigned_to_me (falls back to assignee_id)
             listReviewMrs(): scope=reviews_for_me (falls back to reviewer_id)
             listCreatedMrs(): scope=created_by_me (falls back to author_id)
             getMrContent()/editMr(): GET/PUT merge_requests/:iid
             approve/markReady/close/checkout via glab CLI or approve API
             mergeMr(): PUT /projects/:id/merge_requests/:iid/merge
  github.ts  gh pr create -> gh api -> prefilled compare URL
             listAssignedMrs(): search/issues q=is:pr is:open assignee:@me
             listReviewMrs(): review-requested:@me; enrich via gh pr list per repo
             listCreatedMrs(): author:@me; same enrichment
             getMrContent()/editMr(): gh pr view + PATCH pulls/:number
             approve/ready/close/checkout via gh pr
             mergeMr(): gh pr merge --merge/--squash/--rebase
```

The webview is plain ES modules under `media/`: `main.js` holds state and lifecycle; `lib/views.js` renders the form/progress/result screens (both source and target selectors); `lib/status.js` renders banners, existing-MR alerts and the diff card; `lib/branchPicker.js` is a generic searchable branch combo used for both source and target (with 当前/远端 tags); `lib/assigneePicker.js` is the member picker; `lib/ui.js` and `lib/icons.js` are shared helpers.

The activity bar container `mrTool` holds four views: `mrTool.home` (welcome/launcher), `mrTool.myMrs` (assigned-MR tree), `mrTool.myReviews` (review-requested tree) and `mrTool.myCreated` (open MRs authored by me). The tree views are populated only when the user clicks the refresh command/welcome link; they are scoped to the host of the current repo's origin.

### Webview constraints

- CSP is `script-src ${webview.cspSource} 'nonce-...'`. The cspSource entry is required because ES module `import` requests do not carry the nonce. Keep it when editing the panel.
- The script tag is `type="module"`, so `main.js` runs after DOM parse.
- All dynamic strings inserted into HTML must go through `esc()`. URLs are opened only via the host after an http(s) check.
- `media/style/base.css` loads before `media/style/components.css`; both are referenced from `panel.ts`.

## Behavior worth knowing

- `run()` in `utils/shell.ts` is the only subprocess entry point. It never uses a shell, has a timeout, and augments PATH with Homebrew locations (GUI-launched VS Code often lacks them).
- GitLab `create()` passes explicit `--remove-source-branch=<bool>` / `--squash-before-merge=<bool>` so project defaults cannot override the UI toggles.
- GitLab API fallback uses `glab api --input -` with a JSON body, because `assignee_ids` must be a real array. Curl is only attempted when a token env var exists.
- GitHub does not support delete-source/squash at PR creation; the provider surfaces a warning instead.
- The source branch is editable. `Git.resolveRef()` uses a local branch when present, otherwise `origin/<name>`. `MrService.create()` pushes local sources and skips the push for remote-only sources, aborting if neither exists.
- `Git.diffInfo(source, target)` is relative to `origin/<target>`; a missing source or target yields null (the UI shows a hint).
- The webview sends `inspect {source, target}`; the host returns existing MR + diff + last commit subject/body in one message. Stale responses are dropped by source/target equality plus a sequence number.
- Title auto-fills from the source's last commit subject and description from its body. The webview keeps `lastSubject`/`lastBody`; it only overwrites fields that are empty or still equal to the previous auto value, so manual edits and restored form state are preserved.
- Platform detection: explicit `mrTool.platform` wins; hosts containing github/gitlab are obvious; otherwise the extension prefers an installed and authenticated CLI, then any installed CLI, then GitLab.
- The My MRs list uses GitLab `scope=assigned_to_me` / GitHub `assignee:@me`. Merging honors server-side protections; merge failures surface the API/CLI message. Merge is confirmed with a modal dialog first.
- Default assignees/reviewers come from `mrTool.defaultAssignees` / `mrTool.defaultReviewers` (both default to empty); the current GitLab/GitHub user is inserted as “我” for assignees only.
- The panel remembers target branch, assignee, reviewers and toggles per repo in `workspaceState` (`mrTool.lastForm.<repoRoot>`), and applies them only when the webview has no saved form.
- Merge warns (but still allows) when the MR has conflicts or failed checks; it does not block server-side protected merges.
- Branch names like `feature/123-x` add `Closes #123` to the auto-filled description.
- The legacy `mr.cjs` is excluded from the VSIX via `.vscodeignore`.
