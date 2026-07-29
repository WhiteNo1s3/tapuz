# syntax=docker/dockerfile:1

# Tapuziel is a long-lived Node process — Express + SQLite in one container,
# not a static bundle. `npm run build` only exports published pages to HTML;
# the CMS itself (/admin, the builder, CRM, forms, WhatsApp) needs this to run.
#
# Node 24 "Krypton" is the Active LTS line. Node 26 is Current, not LTS, so a
# deployed CMS deliberately does not sit on it. Node 18 and 20 are end-of-life.
ARG NODE_VERSION=24-bookworm-slim

# ── build stage ──────────────────────────────────────────────────────────
# better-sqlite3 and sharp are native. Both ship prebuilds for linux/amd64
# and linux/arm64, but a platform without one has to compile — so the
# toolchain lives here and never reaches the runtime image.
FROM node:${NODE_VERSION} AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Dependencies resolve from the lockfile alone, so this layer is cached until
# package-lock.json actually changes — application edits never trigger a rebuild
# of the native modules.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── runtime stage ────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}

ENV NODE_ENV=production \
    PORT=3000 \
    TAPUZ_ROOT=/data

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

# The site's own data — db/, config/, public/, content/uploads — lives on the
# volume, NOT in the image, so a redeploy never takes the customer's content
# with it. paths.js reads TAPUZ_ROOT for exactly this; the admin JS keeps
# serving from the package's own public/ via the second express.static mount.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
VOLUME ["/data"]
EXPOSE 3000

# `/` is a 404 until the setup wizard publishes a homepage, so liveness is
# keyed to /admin (302 to setup/login on a fresh install) — anything under 500
# means the process is serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/admin',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

# exec form, no npm wrapper: SIGTERM reaches node directly, so the WAL
# checkpoint on shutdown actually runs instead of being killed with the shell.
CMD ["node", "src/server.js"]
