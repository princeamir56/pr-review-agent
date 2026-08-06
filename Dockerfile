# Web dashboard image: builds the MCP server, the API, and the SPA, then serves
# the API from a slim runtime. The dashboard imports mcp-server/src directly, so
# both packages are installed and compiled in the same build stage.
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Install dependencies first so a source-only change reuses the cached layers.
COPY mcp-server/package*.json ./mcp-server/
RUN --mount=type=cache,target=/root/.npm npm --prefix mcp-server ci

COPY web/package*.json ./web/
COPY web/server/package*.json ./web/server/
COPY web/client/package*.json ./web/client/
RUN --mount=type=cache,target=/root/.npm \
    npm --prefix web ci && npm --prefix web/server ci && npm --prefix web/client ci

COPY mcp-server ./mcp-server
COPY web ./web

# The test suite is the build gate: a broken agent never reaches an image.
RUN npm --prefix mcp-server run test
RUN npm --prefix mcp-server run build \
 && npm --prefix web/server run build \
 && npm --prefix web/client run build


FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# git is needed for owner/repo auto-detection from the mounted repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# web/server/dist already contains the compiled mcp-server sources — the API
# imports them directly, so tsc emits both trees under one root.
COPY --from=build /app/web/server/dist ./web/server/dist
COPY --from=build /app/web/server/node_modules ./web/server/node_modules
COPY --from=build /app/web/server/package.json ./web/server/package.json
COPY --from=build /app/web/client/dist ./web/client/dist

# Reports and the run store are written here — mount a volume to keep them.
RUN mkdir -p /workspace/docs/pr-reviews && chown -R node:node /workspace /app
ENV PR_AGENT_CWD=/workspace
ENV WEB_SERVER_PORT=4000

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server/dist/web/server/src/index.js"]
