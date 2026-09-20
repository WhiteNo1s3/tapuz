# Auto-merge worker

Every pull request into `main` is merged **automatically the moment its CI goes
green** — no label, no manual click. This keeps the branch molten so the tester
always sees the latest.

## How it works

- `.github/workflows/security.yml` runs on every PR (gitleaks + the smoke/test
  suite).
- `.github/workflows/automerge.yml` triggers on `workflow_run` when `security`
  **completes successfully** for a PR, finds the open PR for that branch, and
  merges it into `main` (`--merge --delete-branch`), gated by
  `--match-head-commit` so only the exact commit that passed CI is landed.

## Drafts

A draft PR does **not** merge, and that is the point of a draft. Two things
make it behave:

- `automerge.yml` filters drafts out and says so **in green**. A draft is open,
  so `gh pr list --state open` finds it, and merging one is refused by the API
  — which used to end the job red. A red automerge run now means a real merge
  failure again, not somebody's work in progress.
- `security.yml` lists `ready_for_review` among its `pull_request` types.
  Without it, marking a draft ready runs nothing (the default types are only
  `opened`, `synchronize`, `reopened`), so `automerge` — which only ever fires
  off a `security` run — would never come back, and the PR would sit green,
  ready and unmerged forever.

**Where this came from.** PR #37 (2026-09-20) was opened as a draft. CI went
green, automerge fired on that green run and failed with `Pull Request is still
a draft (mergePullRequest)`. Marking it ready afterwards re-ran nothing, and it
took a human re-running the failed job to land it. The cost of the fix is one
extra CI run per draft that is later marked ready.

## Why a workflow and not a Claude schedule

A Claude scheduled job (session cron) lives **in memory and dies when its
session closes** — nothing is written to disk. That is why an earlier
"auto worker" silently stopped working. A GitHub Actions workflow runs
server-side, on GitHub's schedule, with no session to expire.

## Requirements (already set on this repo)

- Repo → Settings → Actions → Workflow permissions = **Read and write**
  (so the token may merge). Verify: `gh api repos/OWNER/REPO/actions/permissions/workflow`.

## Turning it off

Disable the workflow (`gh workflow disable automerge`) or delete
`.github/workflows/automerge.yml`. Merges then go back to manual (`gh pr merge`).
