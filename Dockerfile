# syntax=docker/dockerfile:1.7
# Nexora web + API. Multi-stage: deps -> build -> slim runtime (Next standalone).
#   docker build -t nexora .
#   docker compose up -d          (see docker-compose.yml: postgres + migrate + app)

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# better-sqlite3 falls back to a source build when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build needs a syntactically valid Postgres DATABASE_URL; no database is contacted.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

# Used by `docker compose run migrate` - has the Prisma CLI and migrations.
FROM builder AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nexora && useradd --system --uid 1001 --gid nexora nexora
COPY --from=builder --chown=nexora:nexora /app/public ./public
COPY --from=builder --chown=nexora:nexora /app/.next/standalone ./
COPY --from=builder --chown=nexora:nexora /app/.next/static ./.next/static
USER nexora
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
