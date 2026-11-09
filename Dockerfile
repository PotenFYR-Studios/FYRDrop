# syntax=docker/dockerfile:1

# --- deps (all, for building the client) ---
FROM oven/bun:1.4-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- production-only deps for the runtime image ---
FROM oven/bun:1.4-debian AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- build client ---
FROM oven/bun:1.4-debian AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json vite.config.ts ./
COPY src ./src
RUN bun run build

# --- runtime ---
FROM oven/bun:1.4-debian AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    MAX_UPLOAD_MB=512

# curl is used by HEALTHCHECK (and for debugging); tini reaps child processes.
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data && chown -R bun:bun /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/server ./src/server
COPY --from=build /app/dist/public ./dist/public
# The server resolves dist/public relative to its own file, so no build tooling
# or client sources are needed at runtime.
RUN chown -R bun:bun /app/dist /app/src

USER bun
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "src/server/index.ts"]
