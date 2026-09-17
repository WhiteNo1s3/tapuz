# CONTINUE HERE

A crashed chat, a new session, or a morning after: run this, in order.

1. **Read** [docs/SESSION-HANDOFF.md](docs/SESSION-HANDOFF.md) — state of main, the arc, the guards.
2. **Catch up:** `git pull` · `git log -15 --oneline` · the top row of [docs/ROADMAP.md](docs/ROADMAP.md).
3. **Prove it still works:** `npm run test:pzn` then `npm run test:smoke`. Red gates come before new work.
4. **Then work** — on a branch, never on `main`.

Standing rules:

- **Nothing personal in the repo.** It is public: no real hostname, hosting or account ids, machine names, personal paths or credentials.
- **A green PR auto-merges, and a merge deploys the live site.**
- **+0.01 per shipped session**, with its Version Log row in `docs/ROADMAP.md`.
- **Ask the owner** for anything irreversible or outward-facing: deleting a page, a password, publishing.
- A session in `.claude/worktrees/<name>` edits only that worktree; the base checkout catches up by pulling.
