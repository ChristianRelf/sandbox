FROM node:20-alpine AS build
WORKDIR /workspace
COPY . .
RUN npm ci --ignore-scripts
RUN npm run marketing:build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/marketing/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/marketing/.next/static ./apps/marketing/.next/static
COPY --from=build --chown=node:node /workspace/apps/marketing/public ./apps/marketing/public
USER node
EXPOSE 3100
CMD ["node", "apps/marketing/server.js"]
