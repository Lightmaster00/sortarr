FROM node:24-alpine AS builder
WORKDIR /app
# Compilation de better-sqlite3 sur Alpine
RUN apk add --no-cache python3 build-base
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache curl su-exec tini
COPY --from=builder /app/.output ./.output
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SORTARR_CONFIG_DIR=/config \
    SORTARR_MEDIA_ROOT=/media

EXPOSE 3000
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "./entrypoint.sh"]
