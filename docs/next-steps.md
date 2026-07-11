# Next Steps for Tapuziel

> The living plan is **[ROADMAP.md](ROADMAP.md)** — phased versions, idea pool, version log.
> This file is just the "where are we / what's next" pointer.

## Where we are (v0.37-alpha)

Everything from the original build order shipped: data model, SQLite, CLI, RTL renderer,
Hebrew admin, default theme — and beyond it: visual builder with modules, draft/publish,
revisions, media library, menu entity, theme overrides, article cubes, guided setup wizard
(v2), and `TAPUZ_ROOT` for running against any site directory.

## Next up

1. **v0.38 — npm publish readiness**: default `TAPUZ_ROOT` to cwd when installed as a
   dependency (bin already exists as `tapuziel` / `tapuz`), `tapuz setup` CLI command on
   top of `src/setup.js`, publish dry-run
2. **CRM properties phase** — contact entity, forms that feed it, leads from the published site
3. **Security phase (pre-beta)** — admin auth, DB encryption, CSRF/rate limits, upload
   validation, CSP (spec'd in ROADMAP)
4. **Ecosystem** — `.pzn` format spec, theme import type, plugin installs, agent mini-API
   (North Star in ROADMAP)

## Decisions locked long ago

- Backend: Node.js + SQLite (better-sqlite3), Express admin
- Blocks: structured JSON, no raw HTML in content ([block-schemas.md](block-schemas.md))
- Hebrew/RTL first-class; agents first-class ([cli-agent-support.md](cli-agent-support.md))
- Versioning: +0.01 per shipped session, logged in ROADMAP
