# Multi-stage build for the React SPA served by nginx.
FROM node:22.23.2-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contract/package.json ./packages/contract/package.json

# `web...` = web plus the workspace packages it depends on (the shared contract types).
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/contract ./packages/contract
COPY apps/web ./apps/web
RUN pnpm --filter web build

FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache gettext

COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY docker/web-entrypoint.sh /docker-entrypoint.d/40-envsubst-web.sh
RUN chmod +x /docker-entrypoint.d/40-envsubst-web.sh

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
