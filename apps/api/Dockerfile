# The runtime is pinned to the same version as .node-version and CI (ADR-0020).
# There is no build stage: Node 24 runs TypeScript by stripping types, which is
# why `npm run openapi` already runs a .ts file directly.
FROM node:24.19.0-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# --ignore-scripts, because `prepare` points git at .githooks and there is no
# git directory in an image. --omit=dev, because nothing here runs a test.
RUN npm ci --workspace apps/api --omit=dev --ignore-scripts

FROM node:24.19.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/package.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY apps/api/drizzle ./apps/api/drizzle
# The base image ships a `node` user. Running as root inside a container is one
# less boundary between a bug in a dependency and the host.
USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "src/server.ts"]
