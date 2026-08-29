# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /source
COPY package.json package-lock.json ./
COPY services/browser-worker/package.json services/browser-worker/package.json
RUN --mount=type=cache,id=sandbox-browser-worker-npm,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --prefer-offline \
      --workspace @sandbox/browser-worker --include-workspace-root=false

FROM deps AS build
COPY services/browser-worker/tsconfig.json services/browser-worker/tsconfig.json
COPY services/browser-worker/src services/browser-worker/src
RUN npm run build --workspace @sandbox/browser-worker

FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts \
      --workspace @sandbox/browser-worker --include-workspace-root=false

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime
WORKDIR /worker
COPY --from=production-deps --chown=pwuser:pwuser /source/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /source/services/browser-worker/dist ./dist
USER pwuser
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/main.js"]
