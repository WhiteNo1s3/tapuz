# Build it at home — your site, your model, then upload it

> The cornerstone, in one sentence (Ben, 2026-09-23): **install Node.js, build the site with your local model, upload the complete site with the photos.**
> No Bridge, no browser extension, no API key. The model and the CMS sit on the same computer, the way a site used to be built on a home machine and pushed to an Apache host.

## 0. What you get

Two ways to ship what you built, and both carry the photos:

| you upload | where it runs | what works there |
|---|---|---|
| the `public/` folder — the **static export** | any web host that serves files: Apache, Nginx, a shared host's `public_html`, GitHub Pages | every page, the theme, the pictures, the menu, the search box, the WhatsApp button, sitemap and robots. Not the parts that need a server: forms, the store, the CRM, the admin |
| the `.pzn` database + the `public/assets` folder — the **whole site** | a Node.js host (Hostinger's Node app, a VPS, Docker) running Tapuziel | everything, the admin and the copilot included |

Nothing in either needs a find-and-replace when the address changes. Every link and every picture is relative (`/about`, `/assets/night/…`); the address lives in ONE field, **Settings → כתובת בסיס (`baseUrl`)**, and it is used only for what must be absolute: canonical tags, Open Graph URLs, the sitemap. Change the field, rebuild, done.

## 1. Install (once)

1. **Node.js 24** — nodejs.org, the LTS installer for your system.
2. **LM Studio** — lmstudio.ai. Download a model: **Gemma 4** (the 12B QAT build on a 12–24 GB card, the 31B on 32 GB; on a Mac with 32 GB or more, the 26B-A4B). `docs/LOCAL-LLM.md` §1 has the numbers behind the choice.
3. **Tapuziel** — `git clone https://github.com/WhiteNo1s3/tapuz.git` (or download the ZIP), then in that folder:

```bash
npm install
npm start
```

Open `http://localhost:3000/admin`. The first visit is the setup wizard: your site's name, colours, the first pages, your admin account. Everything it makes lives under the folder (`db/`, `config/`, `public/`), so a backup of the folder is a backup of the site.

## 2. Connect the model (no Bridge)

1. In LM Studio: load the model, set **Context Length** to **32,768** (or more), and start the **local server** (the default is `http://127.0.0.1:1234`).
2. In Tapuziel: **AI setup** (`/admin/ai-setup`) → the provider **מודל מקומי (LM Studio / Ollama)** → address `http://127.0.0.1:1234/v1` → the model you loaded → save. The screen probes the server and shows the window it found.

That is the whole connection. The CMS calls LM Studio directly, on the same machine; the copilot's screen (`/admin/chat`) works exactly as it does through the Bridge, without the extension.

**On the same network but another machine?** By design the local provider only talks to **loopback** — `127.0.0.1`, `localhost`, `::1` — never to a LAN address (`src/providers.js`; a compromised CMS must not be able to point a key or a prompt at a stranger). Two honest ways:

- run Tapuziel on the machine that has the model (this guide), or
- bring the model's port home with an SSH tunnel from the CMS machine: `ssh -N -L 1234:127.0.0.1:1234 you@the-gpu-box`, then use `http://127.0.0.1:1234/v1` as above. The traffic is encrypted, the CMS still sees loopback.

There is a third way for a site that already lives on a host: the **worker** (`npm run worker` on the model's machine, `docs/LOCAL-LLM.md` §2ב), which polls the hosted site for jobs — no browser, no Bridge. It is for the hosted case, not for building at home.

## 3. Build the site with your model

- **Pictures first.** `/admin/media` → upload your photos (a folder per subject helps). The copilot is briefed with the library's real paths and never invents one; a page it makes uses the pictures you have.
- **Talk to it like a person.** `/admin/chat`: "I am opening a small ceramics studio in Jaffa, I want a page that feels warm and homely." It lists your pages, reads the one you mean, proposes a rendered draft, and stops for **✓ approve**. A page write lands as a draft; publish when you like it. The menu is the one live write and it takes a backup first.
- **The look.** `/admin/theme`: colours, fonts, the menu's shape, a background — or paste a description into the AI designer's box and take the theme it returns. An English site: **Settings → Language → English** turns the site around (new pages read left to right, the chrome speaks English, the copilot writes English).
- **Anything the copilot can do, you can do by hand** in the builder — every proposal is a page of ordinary modules.

The dreams page of the English site shows what fourteen such sentences became, with the seconds and the turns each one took.

## 4. Ship it

### 4a. A static host (Apache, a shared host, GitHub Pages)

```bash
npm run build          # renders every published page into public/
```

`public/` is the complete site: `index.html` and one `.html` per page, `css/main.css` (the theme), `assets/` (your pictures), `search-index.json`, `sitemap.xml`, `robots.txt`. Upload the **contents** of `public/` to the host's web root (FTP, `rsync`, the host's file manager). Two host settings make it feel native:

- serve `/about` for `about.html` — Apache: `Options +MultiViews` or a `.htaccess` rewrite; most shared hosts do this by default
- set **כתובת בסיס** in Settings before the build if you want canonical tags and the sitemap to carry the real domain

Forms, the store and the admin are not on a static host — they are the server's. A brochure site does not need them; a shop does, so it goes to 4b.

### 4b. A Node.js host (the whole site, admin and copilot included)

1. Deploy the **code** the way `docs/DEPLOY.md` describes (Hostinger's Node app from git, a VPS with systemd, Docker Compose). Point its data folder outside the code tree (`TAPUZ_ROOT` or the `.tapuz-root` pin).
2. At home: **Storage** (`/admin/storage`) → **ייצוא .pzn**. That file IS the database — pages, drafts, revisions, menus' history, the media records, the store, the CRM — one SQLite file that identifies itself as a Tapuziel database.
3. Copy the pictures: your `public/assets/` folder to the host's `public/assets/` (rsync, SFTP, the host's file manager). The database holds the records; the folder holds the files.
4. On the host: **Storage** → the restore-from-file control → the `.pzn`. The restore refuses anything that is not a healthy Tapuziel database, keeps a backup of the moment before, and swaps the whole database live, no restart. Then **Settings → כתובת בסיס** → the host's domain → save.

The theme, the menus and the site settings live in `config/` beside the database; copy that folder too, or set them again on the host — `config/` never holds a key.

Going back is the same trip in reverse: export on the host, restore at home.

## 5. What is where

| | |
|---|---|
| the site's data | `db/tapuz.db` (the `.pzn`), `config/*.json`, `public/assets/` |
| the static export | `public/*.html`, `public/css/main.css`, `public/search-index.json` |
| the address | Settings → `baseUrl` — one field |
| the model | LM Studio on `127.0.0.1:1234`; the CMS never sends a prompt anywhere else on the local tier |
| how it was proved | `docs/LOCAL-LLM.md` §5: the copilot battery on a Mac, through the relay and through the real Bridge, and the English track |

## 6. Why this is the cornerstone

The owner's own machine does the thinking and the building, for free, and the result is a folder of files a host has served since 1996 — or one database file plus a folder of pictures for a host that runs Node. There is no subscription between the owner and their site, and nothing to migrate but an address in one field.
