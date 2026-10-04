# syntax=docker/dockerfile:1
#
# WealthHabit API — production image.
#
# Build context is the repository root (npm workspaces share one lockfile):
#   docker build -f server/Dockerfile -t wealthhabit-server:local .
#
# The image contains no .env file, no secrets and no database credentials:
# NODE_ENV, DATABASE_URL, JWT_ACCESS_SECRET, CLIENT_URL, COOKIE_* and
# TRUST_PROXY are injected at container start.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prisma picks its query-engine build from the local OpenSSL version, and
# node:22-bookworm-slim ships neither the `openssl` binary nor libssl. Without
# this it silently falls back to an openssl-1.1.x engine that cannot load on
# bookworm. The runtime stage installs the matching libssl3.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies against the committed lockfile first so source edits
# do not invalidate the dependency layer.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --workspace=server

# Compile TypeScript and generate the Prisma client (server "build" script:
# prisma generate && tsc). Running through npm sets cwd to server/, which is
# where prisma/ and tsconfig.json are resolved from.
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/prisma ./server/prisma
COPY server/src ./server/src
RUN npm run build --workspace=server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Shared library required by the Prisma query engine generated above.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libssl3 \
  && rm -rf /var/lib/apt/lists/*

# Runtime dependencies only - dev tooling (typescript, vitest, eslint, tsx,
# prettier) is never installed here. The prisma CLI does appear: npm
# auto-installs @prisma/client's `prisma` peer dependency. It is never
# invoked at start-up; see the README follow-up on image slimming.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --workspace=server --omit=dev

# The Prisma client and its query engine are produced by `prisma generate`
# in the builder and copied over the runtime install; the runtime install
# alone would not contain them.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/server/dist ./server/dist

# Never runs migrations: schema changes are applied out of band (see README,
# "Production containers"), so a container start cannot mutate the database.
#
# The runtime user only ever reads /app (npm ci and the artifact copies are
# 0644/0755), so there is deliberately no recursive chown - it would rewrite
# the whole node_modules tree into an extra layer. The user's home directory
# (created by --create-home) and /tmp are the writable locations.
RUN useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin app

USER app
WORKDIR /app/server

ENV PORT=5000
EXPOSE 5000

# Readiness probe: 200 only when the database answers SELECT 1
# (GET /api/health/ready). GET /api/health is the liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Matches "npm start" (node dist/server.js). The process is PID 1 and handles
# SIGTERM/SIGINT itself via server/src/lifecycle.ts, so `docker stop` performs
# the existing graceful shutdown.
CMD ["node", "dist/server.js"]
