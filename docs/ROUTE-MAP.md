# Route map — which file owns which HTTP route

Generated from the source by `scripts/gen-route-map.js` (regenerate with
`npm run gen:route-map`; `smoke-route-map.js` fails the build if this drifts).
The navigational manifest for the modular HTTP surface: after the route-group
extractions, every admin/public/agent route lives in its own module — this
shows where, so editing is navigation, not a grep hunt.

**183 routes across 35 files.**

## By file (what each module owns)

### `src/server.js` — 5 routes

- `POST /_tapuz/collect`
- `GET /pzn-schema.json`
- `GET /admin/api/registry`
- `GET /admin/bentml-engine.js`
- `GET /admin/api/bentml/modules`

### `src/routes/admin-home.js` — 1 route

- `GET /admin`

### `src/routes/agent-bridge.js` — 15 routes

- `GET /agent/v1/ping`
- `GET /agent/v1/providers`
- `GET /agent/v1/primer`
- `GET /agent/v1/toolbox`
- `GET /agent/v1/dictionary`
- `GET /agent/v1/roleplay`
- `GET /agent/v1/media`
- `GET /agent/v1/mission`
- `POST /agent/v1/mission/:id/step`
- `GET /agent/v1/pages`
- `GET /agent/v1/source`
- `POST /agent/v1/source`
- `POST /agent/v1/ops`
- `POST /agent/v1/create-from-source`
- `POST /agent/v1/build`

### `src/routes/agent-tokens.js` — 3 routes

- `GET /admin/api/agent-tokens`
- `POST /admin/api/agent-tokens`
- `DELETE /admin/api/agent-tokens/:id`

### `src/routes/analytics.js` — 2 routes

- `GET /admin/analytics.csv`
- `GET /admin/analytics`

### `src/routes/auth-screens.js` — 5 routes

- `GET /admin/login`
- `POST /admin/login`
- `POST /admin/logout`
- `GET /admin/create-account`
- `POST /admin/create-account`

### `src/routes/bentml-api.js` — 7 routes

- `GET /admin/api/bentml/primer`
- `GET /admin/api/bentml/chat-snippet`
- `GET /admin/api/bentml/agent-pack`
- `POST /admin/api/bentml/compile`
- `POST /admin/api/bentml/preview`
- `POST /admin/api/bentml/decompile`
- `POST /admin/api/bentml/apply`

### `src/routes/categories.js` — 3 routes

- `GET /admin/api/categories`
- `POST /admin/api/categories`
- `GET /admin/categories`

### `src/routes/content-api.js` — 4 routes

- `GET /admin/api/pages`
- `GET /admin/api/articles`
- `GET /admin/api/revisions/:fullPath`
- `POST /admin/api/revisions/restore`

### `src/routes/copilot.js` — 11 routes

- `GET /admin/agent`
- `GET /admin/ai`
- `GET /admin/inject`
- `GET /admin/api/pzn/repair-stats`
- `GET /admin/api/syntax-dictionary`
- `GET /admin/api/syntax-dictionary.md`
- `GET /admin/api/inject-pack`
- `GET /admin/api/ai/settings`
- `POST /admin/api/ai/settings`
- `POST /admin/api/ai/chat`
- `GET /admin/chat`

### `src/routes/crm-track.js` — 8 routes

- `GET /crm/o/:token.gif`
- `GET /crm/c/:token/:index`
- `GET /crm/u/:token`
- `POST /crm/u/:token`
- `GET /tz-cs-chat.js`
- `GET /crm/cs/v1/config`
- `POST /crm/cs/v1/session`
- `POST /crm/cs/v1/message`

### `src/routes/crm.js` — 28 routes

- `POST /admin/crm/settings`
- `GET /admin/crm/segments`
- `POST /admin/crm/segments`
- `POST /admin/crm/segments/:id/delete`
- `GET /admin/crm/lists`
- `POST /admin/crm/lists`
- `POST /admin/crm/lists/:id/delete`
- `GET /admin/crm/pixels`
- `POST /admin/crm/pixels`
- `GET /admin/crm/chat`
- `POST /admin/crm/chat`
- `GET /admin/crm/chat/:id`
- `GET /admin/crm/privacy`
- `POST /admin/crm/privacy`
- `GET /admin/crm/campaigns`
- `POST /admin/crm/campaigns`
- `GET /admin/crm/campaigns/:id`
- `POST /admin/crm/campaigns/:id/update`
- `POST /admin/crm/campaigns/:id/send`
- `POST /admin/crm/campaigns/:id/delete`
- `GET /admin/crm/conversions`
- `POST /admin/crm/conversions`
- `GET /admin/crm`
- `GET /admin/crm/:id`
- `POST /admin/crm/:id/update`
- `POST /admin/crm/:id/note`
- `GET /admin/crm/:id/export.json`
- `POST /admin/crm/:id/delete`

### `src/routes/dashboard.js` — 2 routes

- `GET /admin/dashboard`
- `POST /admin/build-redirect`

### `src/routes/form-capture.js` — 2 routes

- `POST /api/form`
- `GET /form-sent`

### `src/routes/homepage.js` — 2 routes

- `POST /admin/homepage`
- `POST /admin/api/homepage`

### `src/routes/import.js` — 2 routes

- `POST /admin/api/import`
- `GET /admin/import`

### `src/routes/inbox.js` — 8 routes

- `GET /admin/inbox`
- `GET /admin/inbox.csv`
- `POST /admin/inbox/read`
- `POST /admin/inbox/delete`
- `POST /admin/inbox/status`
- `POST /admin/inbox/notes`
- `POST /admin/inbox/value`
- `POST /admin/inbox/follow-up`

### `src/routes/integrations.js` — 6 routes

- `GET /admin/integrations`
- `GET /admin/api/integrations`
- `POST /admin/api/integrations`
- `GET /admin/api/notify/settings`
- `POST /admin/api/notify/settings`
- `POST /admin/api/notify/test`

### `src/routes/media.js` — 8 routes

- `GET /admin/media`
- `POST /admin/media/folder`
- `POST /admin/media/delete-folder`
- `POST /admin/media/delete`
- `POST /admin/media/move`
- `GET /admin/assets`
- `POST /admin/upload`
- `GET /admin/media-library`

### `src/routes/menus.js` — 5 routes

- `GET /admin/api/menus`
- `POST /admin/api/menus`
- `POST /admin/api/menus/:name/delete`
- `POST /admin/api/menus/:name`
- `GET /admin/menus`

### `src/routes/mission.js` — 4 routes

- `GET /admin/api/mission/providers`
- `POST /admin/api/mission/teach`
- `POST /admin/api/mission/create`
- `POST /admin/api/mission/activate/:id`

### `src/routes/pages-builder.js` — 8 routes

- `GET /admin/new`
- `POST /admin/create`
- `POST /admin/delete`
- `GET /admin/preview/:fullPath`
- `GET /admin/edit/:fullPath`
- `POST /admin/save`
- `POST /admin/publish`
- `POST /admin/build`

### `src/routes/pzn-pages.js` — 5 routes

- `GET /admin/api/pzn/source`
- `POST /admin/api/pzn/source`
- `POST /admin/api/pzn/decompile`
- `POST /admin/api/pzn/ops`
- `POST /admin/api/pzn/create-from-source`

### `src/routes/pzn-tools.js` — 6 routes

- `POST /admin/api/pzn/repair`
- `POST /admin/api/pzn/graduate`
- `POST /admin/api/pzn/to-blocks`
- `GET /admin/api/pzn/toolbox`
- `GET /admin/api/pzn/primer`
- `POST /admin/api/pzn/preview`

### `src/routes/seo-files.js` — 2 routes

- `GET /sitemap.xml`
- `GET /robots.txt`

### `src/routes/seo.js` — 3 routes

- `GET /admin/seo`
- `GET /admin/api/seo`
- `POST /admin/api/seo`

### `src/routes/settings.js` — 4 routes

- `GET /admin/settings`
- `POST /admin/api/settings`
- `GET /admin/api/site-package/export`
- `POST /admin/api/site-package/import`

### `src/routes/setup-wizard.js` — 2 routes

- `GET /admin/setup`
- `POST /admin/setup`

### `src/routes/site-chrome.js` — 3 routes

- `GET /admin/site-chrome`
- `GET /admin/api/site-chrome`
- `POST /admin/api/site-chrome`

### `src/routes/sitemap.js` — 2 routes

- `GET /admin/api/sitemap`
- `GET /admin/sitemap`

### `src/routes/storage.js` — 2 routes

- `GET /admin/api/storage`
- `GET /admin/storage`

### `src/routes/symbols.js` — 3 routes

- `GET /admin/api/symbols`
- `POST /admin/api/symbols`
- `POST /admin/api/symbols/delete`

### `src/routes/team.js` — 4 routes

- `GET /admin/team`
- `POST /admin/api/team`
- `POST /admin/api/team/:id/role`
- `DELETE /admin/api/team/:id`

### `src/routes/theme.js` — 5 routes

- `GET /admin/api/theme`
- `POST /admin/api/theme`
- `GET /admin/api/theme/export`
- `POST /admin/api/theme/import`
- `GET /admin/theme`

### `src/routes/translations.js` — 3 routes

- `GET /admin/translations`
- `POST /admin/api/translations/link`
- `POST /admin/api/translations/unlink`

## Alphabetical (find a route → its file)

| Route | Method | File |
|---|---|---|
| `/_tapuz/collect` | POST | `src/server.js` |
| `/admin` | GET | `src/routes/admin-home.js` |
| `/admin/agent` | GET | `src/routes/copilot.js` |
| `/admin/ai` | GET | `src/routes/copilot.js` |
| `/admin/analytics` | GET | `src/routes/analytics.js` |
| `/admin/analytics.csv` | GET | `src/routes/analytics.js` |
| `/admin/api/agent-tokens` | GET | `src/routes/agent-tokens.js` |
| `/admin/api/agent-tokens` | POST | `src/routes/agent-tokens.js` |
| `/admin/api/agent-tokens/:id` | DELETE | `src/routes/agent-tokens.js` |
| `/admin/api/ai/chat` | POST | `src/routes/copilot.js` |
| `/admin/api/ai/settings` | GET | `src/routes/copilot.js` |
| `/admin/api/ai/settings` | POST | `src/routes/copilot.js` |
| `/admin/api/articles` | GET | `src/routes/content-api.js` |
| `/admin/api/bentml/agent-pack` | GET | `src/routes/bentml-api.js` |
| `/admin/api/bentml/apply` | POST | `src/routes/bentml-api.js` |
| `/admin/api/bentml/chat-snippet` | GET | `src/routes/bentml-api.js` |
| `/admin/api/bentml/compile` | POST | `src/routes/bentml-api.js` |
| `/admin/api/bentml/decompile` | POST | `src/routes/bentml-api.js` |
| `/admin/api/bentml/modules` | GET | `src/server.js` |
| `/admin/api/bentml/preview` | POST | `src/routes/bentml-api.js` |
| `/admin/api/bentml/primer` | GET | `src/routes/bentml-api.js` |
| `/admin/api/categories` | GET | `src/routes/categories.js` |
| `/admin/api/categories` | POST | `src/routes/categories.js` |
| `/admin/api/homepage` | POST | `src/routes/homepage.js` |
| `/admin/api/import` | POST | `src/routes/import.js` |
| `/admin/api/inject-pack` | GET | `src/routes/copilot.js` |
| `/admin/api/integrations` | GET | `src/routes/integrations.js` |
| `/admin/api/integrations` | POST | `src/routes/integrations.js` |
| `/admin/api/menus` | GET | `src/routes/menus.js` |
| `/admin/api/menus` | POST | `src/routes/menus.js` |
| `/admin/api/menus/:name` | POST | `src/routes/menus.js` |
| `/admin/api/menus/:name/delete` | POST | `src/routes/menus.js` |
| `/admin/api/mission/activate/:id` | POST | `src/routes/mission.js` |
| `/admin/api/mission/create` | POST | `src/routes/mission.js` |
| `/admin/api/mission/providers` | GET | `src/routes/mission.js` |
| `/admin/api/mission/teach` | POST | `src/routes/mission.js` |
| `/admin/api/notify/settings` | GET | `src/routes/integrations.js` |
| `/admin/api/notify/settings` | POST | `src/routes/integrations.js` |
| `/admin/api/notify/test` | POST | `src/routes/integrations.js` |
| `/admin/api/pages` | GET | `src/routes/content-api.js` |
| `/admin/api/pzn/create-from-source` | POST | `src/routes/pzn-pages.js` |
| `/admin/api/pzn/decompile` | POST | `src/routes/pzn-pages.js` |
| `/admin/api/pzn/graduate` | POST | `src/routes/pzn-tools.js` |
| `/admin/api/pzn/ops` | POST | `src/routes/pzn-pages.js` |
| `/admin/api/pzn/preview` | POST | `src/routes/pzn-tools.js` |
| `/admin/api/pzn/primer` | GET | `src/routes/pzn-tools.js` |
| `/admin/api/pzn/repair` | POST | `src/routes/pzn-tools.js` |
| `/admin/api/pzn/repair-stats` | GET | `src/routes/copilot.js` |
| `/admin/api/pzn/source` | GET | `src/routes/pzn-pages.js` |
| `/admin/api/pzn/source` | POST | `src/routes/pzn-pages.js` |
| `/admin/api/pzn/to-blocks` | POST | `src/routes/pzn-tools.js` |
| `/admin/api/pzn/toolbox` | GET | `src/routes/pzn-tools.js` |
| `/admin/api/registry` | GET | `src/server.js` |
| `/admin/api/revisions/:fullPath` | GET | `src/routes/content-api.js` |
| `/admin/api/revisions/restore` | POST | `src/routes/content-api.js` |
| `/admin/api/seo` | GET | `src/routes/seo.js` |
| `/admin/api/seo` | POST | `src/routes/seo.js` |
| `/admin/api/settings` | POST | `src/routes/settings.js` |
| `/admin/api/site-chrome` | GET | `src/routes/site-chrome.js` |
| `/admin/api/site-chrome` | POST | `src/routes/site-chrome.js` |
| `/admin/api/site-package/export` | GET | `src/routes/settings.js` |
| `/admin/api/site-package/import` | POST | `src/routes/settings.js` |
| `/admin/api/sitemap` | GET | `src/routes/sitemap.js` |
| `/admin/api/storage` | GET | `src/routes/storage.js` |
| `/admin/api/symbols` | GET | `src/routes/symbols.js` |
| `/admin/api/symbols` | POST | `src/routes/symbols.js` |
| `/admin/api/symbols/delete` | POST | `src/routes/symbols.js` |
| `/admin/api/syntax-dictionary` | GET | `src/routes/copilot.js` |
| `/admin/api/syntax-dictionary.md` | GET | `src/routes/copilot.js` |
| `/admin/api/team` | POST | `src/routes/team.js` |
| `/admin/api/team/:id` | DELETE | `src/routes/team.js` |
| `/admin/api/team/:id/role` | POST | `src/routes/team.js` |
| `/admin/api/theme` | GET | `src/routes/theme.js` |
| `/admin/api/theme` | POST | `src/routes/theme.js` |
| `/admin/api/theme/export` | GET | `src/routes/theme.js` |
| `/admin/api/theme/import` | POST | `src/routes/theme.js` |
| `/admin/api/translations/link` | POST | `src/routes/translations.js` |
| `/admin/api/translations/unlink` | POST | `src/routes/translations.js` |
| `/admin/assets` | GET | `src/routes/media.js` |
| `/admin/bentml-engine.js` | GET | `src/server.js` |
| `/admin/build` | POST | `src/routes/pages-builder.js` |
| `/admin/build-redirect` | POST | `src/routes/dashboard.js` |
| `/admin/categories` | GET | `src/routes/categories.js` |
| `/admin/chat` | GET | `src/routes/copilot.js` |
| `/admin/create` | POST | `src/routes/pages-builder.js` |
| `/admin/create-account` | GET | `src/routes/auth-screens.js` |
| `/admin/create-account` | POST | `src/routes/auth-screens.js` |
| `/admin/crm` | GET | `src/routes/crm.js` |
| `/admin/crm/:id` | GET | `src/routes/crm.js` |
| `/admin/crm/:id/delete` | POST | `src/routes/crm.js` |
| `/admin/crm/:id/export.json` | GET | `src/routes/crm.js` |
| `/admin/crm/:id/note` | POST | `src/routes/crm.js` |
| `/admin/crm/:id/update` | POST | `src/routes/crm.js` |
| `/admin/crm/campaigns` | GET | `src/routes/crm.js` |
| `/admin/crm/campaigns` | POST | `src/routes/crm.js` |
| `/admin/crm/campaigns/:id` | GET | `src/routes/crm.js` |
| `/admin/crm/campaigns/:id/delete` | POST | `src/routes/crm.js` |
| `/admin/crm/campaigns/:id/send` | POST | `src/routes/crm.js` |
| `/admin/crm/campaigns/:id/update` | POST | `src/routes/crm.js` |
| `/admin/crm/chat` | GET | `src/routes/crm.js` |
| `/admin/crm/chat` | POST | `src/routes/crm.js` |
| `/admin/crm/chat/:id` | GET | `src/routes/crm.js` |
| `/admin/crm/conversions` | GET | `src/routes/crm.js` |
| `/admin/crm/conversions` | POST | `src/routes/crm.js` |
| `/admin/crm/lists` | GET | `src/routes/crm.js` |
| `/admin/crm/lists` | POST | `src/routes/crm.js` |
| `/admin/crm/lists/:id/delete` | POST | `src/routes/crm.js` |
| `/admin/crm/pixels` | GET | `src/routes/crm.js` |
| `/admin/crm/pixels` | POST | `src/routes/crm.js` |
| `/admin/crm/privacy` | GET | `src/routes/crm.js` |
| `/admin/crm/privacy` | POST | `src/routes/crm.js` |
| `/admin/crm/segments` | GET | `src/routes/crm.js` |
| `/admin/crm/segments` | POST | `src/routes/crm.js` |
| `/admin/crm/segments/:id/delete` | POST | `src/routes/crm.js` |
| `/admin/crm/settings` | POST | `src/routes/crm.js` |
| `/admin/dashboard` | GET | `src/routes/dashboard.js` |
| `/admin/delete` | POST | `src/routes/pages-builder.js` |
| `/admin/edit/:fullPath` | GET | `src/routes/pages-builder.js` |
| `/admin/homepage` | POST | `src/routes/homepage.js` |
| `/admin/import` | GET | `src/routes/import.js` |
| `/admin/inbox` | GET | `src/routes/inbox.js` |
| `/admin/inbox.csv` | GET | `src/routes/inbox.js` |
| `/admin/inbox/delete` | POST | `src/routes/inbox.js` |
| `/admin/inbox/follow-up` | POST | `src/routes/inbox.js` |
| `/admin/inbox/notes` | POST | `src/routes/inbox.js` |
| `/admin/inbox/read` | POST | `src/routes/inbox.js` |
| `/admin/inbox/status` | POST | `src/routes/inbox.js` |
| `/admin/inbox/value` | POST | `src/routes/inbox.js` |
| `/admin/inject` | GET | `src/routes/copilot.js` |
| `/admin/integrations` | GET | `src/routes/integrations.js` |
| `/admin/login` | GET | `src/routes/auth-screens.js` |
| `/admin/login` | POST | `src/routes/auth-screens.js` |
| `/admin/logout` | POST | `src/routes/auth-screens.js` |
| `/admin/media` | GET | `src/routes/media.js` |
| `/admin/media-library` | GET | `src/routes/media.js` |
| `/admin/media/delete` | POST | `src/routes/media.js` |
| `/admin/media/delete-folder` | POST | `src/routes/media.js` |
| `/admin/media/folder` | POST | `src/routes/media.js` |
| `/admin/media/move` | POST | `src/routes/media.js` |
| `/admin/menus` | GET | `src/routes/menus.js` |
| `/admin/new` | GET | `src/routes/pages-builder.js` |
| `/admin/preview/:fullPath` | GET | `src/routes/pages-builder.js` |
| `/admin/publish` | POST | `src/routes/pages-builder.js` |
| `/admin/save` | POST | `src/routes/pages-builder.js` |
| `/admin/seo` | GET | `src/routes/seo.js` |
| `/admin/settings` | GET | `src/routes/settings.js` |
| `/admin/setup` | GET | `src/routes/setup-wizard.js` |
| `/admin/setup` | POST | `src/routes/setup-wizard.js` |
| `/admin/site-chrome` | GET | `src/routes/site-chrome.js` |
| `/admin/sitemap` | GET | `src/routes/sitemap.js` |
| `/admin/storage` | GET | `src/routes/storage.js` |
| `/admin/team` | GET | `src/routes/team.js` |
| `/admin/theme` | GET | `src/routes/theme.js` |
| `/admin/translations` | GET | `src/routes/translations.js` |
| `/admin/upload` | POST | `src/routes/media.js` |
| `/agent/v1/build` | POST | `src/routes/agent-bridge.js` |
| `/agent/v1/create-from-source` | POST | `src/routes/agent-bridge.js` |
| `/agent/v1/dictionary` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/media` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/mission` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/mission/:id/step` | POST | `src/routes/agent-bridge.js` |
| `/agent/v1/ops` | POST | `src/routes/agent-bridge.js` |
| `/agent/v1/pages` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/ping` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/primer` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/providers` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/roleplay` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/source` | GET | `src/routes/agent-bridge.js` |
| `/agent/v1/source` | POST | `src/routes/agent-bridge.js` |
| `/agent/v1/toolbox` | GET | `src/routes/agent-bridge.js` |
| `/api/form` | POST | `src/routes/form-capture.js` |
| `/crm/c/:token/:index` | GET | `src/routes/crm-track.js` |
| `/crm/cs/v1/config` | GET | `src/routes/crm-track.js` |
| `/crm/cs/v1/message` | POST | `src/routes/crm-track.js` |
| `/crm/cs/v1/session` | POST | `src/routes/crm-track.js` |
| `/crm/o/:token.gif` | GET | `src/routes/crm-track.js` |
| `/crm/u/:token` | GET | `src/routes/crm-track.js` |
| `/crm/u/:token` | POST | `src/routes/crm-track.js` |
| `/form-sent` | GET | `src/routes/form-capture.js` |
| `/pzn-schema.json` | GET | `src/server.js` |
| `/robots.txt` | GET | `src/routes/seo-files.js` |
| `/sitemap.xml` | GET | `src/routes/seo-files.js` |
| `/tz-cs-chat.js` | GET | `src/routes/crm-track.js` |

