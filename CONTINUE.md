# CONTINUE HERE

If the chat crashed, or you are a new agent session, do these in order:

1. Read **[docs/SESSION-HANDOFF.md](docs/SESSION-HANDOFF.md)** — the full state, kept current.
2. `git pull && npm ci && npm run qa:quick` — every gate must be green before you touch anything.
3. `git log -15 --oneline` — what the last sessions actually shipped.
4. Work on **`main`** unless the handoff says otherwise.

## Standing rules (these do not change between sessions)

- **The repo is public.** Never commit a hosting account id, a real
  `*.hostingersite.com` hostname, a personal mailbox, or a path from someone's
  machine. `.gitleaks.toml` fails CI on them. Placeholders are the way.
- **Node 24** (`engines`), and CI runs 24.
- **Every shipped session is +0.01** with its own row in the `docs/ROADMAP.md`
  Version Log — what shipped, whose idea. Never +1.0, never a skip, never a bare
  bump with nothing shipped. `npm run test:version` enforces it.
- **A green PR auto-merges into `main`** (`.github/workflows/automerge.yml`).
  Open it as a **draft** if you are not ready for that.
- **Finish by updating the handoff** (its §12 protocol). This file and the
  handoff are the memory — nothing else survives the chat.

Local-only, not on the remote: a `session/handoff` worktree if you made one.
