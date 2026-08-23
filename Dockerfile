# craigsnotice_api
#
# Built from the MONOREPO ROOT, not from craigsnotice_api/. The API depends on
# @craigsnotice/types through a `workspace:*` link, so the build context has to
# contain the workspace root or the dependency cannot resolve. Build with:
#
#   docker build -t craigsnotice_api .
#
# ---------------------------------------------------------------------------

FROM oven/bun:1 AS builder

WORKDIR /app

# Workspace manifests first, so dependency layers cache independently of source.
# ALL five manifests are needed even though only two packages ship: the root
# package.json lists five workspaces and `bun install` refuses to run when one
# is missing ("Workspace not found"). The manifests are tiny; the frontend
# source is never copied.
COPY package.json bun.lock tsconfig.base.json ./
COPY craigsnotice_types/package.json ./craigsnotice_types/
COPY craigsnotice_api/package.json ./craigsnotice_api/
COPY craigsnotice_client/package.json ./craigsnotice_client/
COPY craigsnotice_lib/package.json ./craigsnotice_lib/
COPY craigsnotice_app/package.json ./craigsnotice_app/

ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc && \
    bun install --frozen-lockfile && \
    rm ~/.npmrc

# Only the two packages the API needs. The frontend packages are not involved.
COPY craigsnotice_types ./craigsnotice_types
COPY craigsnotice_api ./craigsnotice_api

RUN cd craigsnotice_api && bunx tsc --noEmit -p tsconfig.json

# ---------------------------------------------------------------------------

FROM oven/bun:1-slim AS production

# curl for the healthcheck; node+npm because the Bright Data CLI is an npm
# package and self-healing shells out to it. There is no REST heal endpoint,
# so without this binary a broken scraper cannot repair itself.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    nodejs \
    npm \
    && npm install -g @brightdata/cli \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

# No `bdata login` step: the CLI authenticates from BRIGHTDATA_API_KEY, so the
# image carries no credentials and the key is supplied at run time.

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY craigsnotice_types/package.json ./craigsnotice_types/
COPY craigsnotice_api/package.json ./craigsnotice_api/
COPY craigsnotice_client/package.json ./craigsnotice_client/
COPY craigsnotice_lib/package.json ./craigsnotice_lib/
COPY craigsnotice_app/package.json ./craigsnotice_app/

ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc && \
    bun install --frozen-lockfile --production && \
    rm ~/.npmrc

# Bun runs TypeScript directly, so there is nothing to compile.
COPY craigsnotice_types ./craigsnotice_types
COPY craigsnotice_api ./craigsnotice_api
COPY port ./port

ENV NODE_ENV=production
ENV PORT=8022

EXPOSE 8022

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8022/health || exit 1

WORKDIR /app/craigsnotice_api

# --preload wires up OpenTelemetry before the app starts.
CMD ["bun", "run", "--preload", "./src/otel.ts", "src/index.ts"]
