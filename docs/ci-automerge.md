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
