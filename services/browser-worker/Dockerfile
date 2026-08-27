FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /worker
COPY services/browser-worker/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts
COPY services/browser-worker/dist ./dist
USER pwuser
ENV NODE_ENV=production
ENTRYPOINT ["node","dist/main.js"]
