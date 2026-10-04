# syntax=docker/dockerfile:1
#
# WealthHabit frontend — production image (static assets behind nginx).
#
# Build context is the repository root (npm workspaces share one lockfile):
#   docker build -f client/Dockerfile -t wealthhabit-client:local .
#
# Frontend configuration is BUILD-TIME: Vite inlines every VITE_* variable into
# the bundle, so it is readable in the browser and must never hold a secret.
#   docker build -f client/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example.com/api ...
# Left unset, the bundle calls the API on the same origin ("/api"), which this
# image proxies to the API container (API_PROXY_PASS, settable at run time).

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
RUN npm ci --workspace=client

COPY client ./client

ARG VITE_API_BASE_URL=""
RUN if [ -n "$VITE_API_BASE_URL" ]; then \
      VITE_API_BASE_URL="$VITE_API_BASE_URL" npm run build --workspace=client; \
    else \
      npm run build --workspace=client; \
    fi

FROM nginx:1.27-alpine AS runtime

# Unprivileged runtime: custom main config (pid and temp files under /tmp,
# listen on 8080) and a config.d entry rendered from the template at start.
# conf.d/templates must be writable by the nginx user so the entrypoint can
# render the template; the html tree is read-only at run time.
COPY client/nginx/nginx.conf /etc/nginx/nginx.conf
COPY client/nginx/default.conf.template /etc/nginx/templates/default.conf.template
RUN chown -R nginx:nginx /etc/nginx/templates /etc/nginx/conf.d

COPY --from=build /app/client/dist /usr/share/nginx/html

USER nginx

# Upstream API container (compose service name); override at run time when the
# API lives elsewhere, e.g. -e API_PROXY_PASS=http://host.docker.internal:5000.
# nginx resolves this host once at start-up and refuses to start if it does
# not exist, so a wrong upstream fails fast instead of failing silently.
ENV API_PROXY_PASS=http://server:5000

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
