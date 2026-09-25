# syntax=docker/dockerfile:1
# Build context is the repository root: docker build -f docker/api.Dockerfile .

FROM node:22-bookworm-slim AS base
# Corepack activates the pnpm version pinned in package.json "packageManager".
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm --version
# Manifests only, so the dependency layer is cached until a package.json or the lockfile changes.
COPY apps/api/package.json apps/api/package.json

# One stage owns the whole install: it compiles, then assembles the production tree in /out.
FROM base AS build
RUN pnpm install --frozen-lockfile --filter api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
# S1.3 insertion point A (compile-time): generate the Prisma client here, before the build.
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build
# /out holds only the compiled dist plus production dependencies (fresh install from the same lockfile).
RUN pnpm --filter api deploy --prod /out
# S1.3 insertion point B (runtime tree): a generated client lands inside /out/node_modules, so generate
# again here, run from /out (the Prisma CLI must be a production dependency of api).
RUN cd /out && node_modules/.bin/prisma generate

# One-shot schema job (compose `migrate` service): the full build tree already holds the Prisma
# CLI, the migrations, the seed and tsx, none of which the slim runtime image carries. It applies
# pending migrations, then runs the insert-only seed (D33: it creates missing rows and never
# updates an existing one, so re-running it on every `up` is a no-op).
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed"]

FROM node:22-bookworm-slim AS runtime
# S1.3: if the Prisma engine needs it, install openssl here (the slim image ships none):
# RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
