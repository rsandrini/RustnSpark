# syntax=docker/dockerfile:1
# Build context is the repository root: docker build -f docker/api.Dockerfile .

FROM node:22-bookworm-slim AS base
# Corepack activates the pnpm version pinned in package.json "packageManager".
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm --version

# Manifests only, so the dependency layers are cached until a package.json or the lockfile changes.
FROM base AS manifests
COPY apps/api/package.json apps/api/package.json

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter api build

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter api...

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/api
COPY --from=prod-deps --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
