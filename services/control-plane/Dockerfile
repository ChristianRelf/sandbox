# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /source
COPY package.json package-lock.json ./
COPY services/control-plane/package.json services/control-plane/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=sandbox-control-plane-npm,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --prefer-offline \
      --workspace @sandbox/control-plane \
      --workspace @sandbox/api-client \
      --workspace @sandbox/contracts \
      --include-workspace-root=false

FROM deps AS build
COPY services/control-plane/tsconfig.json services/control-plane/tsconfig.json
COPY services/control-plane/src services/control-plane/src
COPY packages/api-client/tsconfig.json packages/api-client/tsconfig.json
COPY packages/api-client/src packages/api-client/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
RUN npm run build --workspace @sandbox/control-plane

FROM deps AS production-deps
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline \
      --workspace @sandbox/control-plane \
      --workspace @sandbox/contracts \
      --include-workspace-root=false

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=production-deps --chown=node:node /source/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /source/services/control-plane/node_modules ./services/control-plane/node_modules
COPY --from=build --chown=node:node /source/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /source/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /source/services/control-plane/package.json ./services/control-plane/package.json
COPY --from=build --chown=node:node /source/services/control-plane/dist ./services/control-plane/dist
COPY --chown=node:node services/control-plane/db ./services/control-plane/db
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=8 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["sh", "-c", "node services/control-plane/dist/migrate.js && exec node services/control-plane/dist/main.js"]
