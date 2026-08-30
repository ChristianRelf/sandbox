# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/docs/package.json apps/docs/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=sandbox-docs-npm,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --prefer-offline \
      --workspace @sandbox/docs --include-workspace-root=false

FROM deps AS build
COPY apps/docs apps/docs
COPY docs/api docs/api
COPY packages/brand packages/brand
COPY packages/ui packages/ui
COPY scripts/generate-node-reference.ts scripts/generate-node-reference.ts
COPY src/catalogue.ts src/catalogue.ts
COPY src/types.ts src/types.ts
RUN --mount=type=cache,id=sandbox-docs-next,target=/workspace/apps/docs/.next/cache \
    npm run build --workspace @sandbox/docs

FROM node:20-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3200
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/docs/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/docs/.next/static ./apps/docs/.next/static
COPY --from=build --chown=node:node /workspace/apps/docs/public ./apps/docs/public
USER node
EXPOSE 3200
CMD ["node", "apps/docs/server.js"]
