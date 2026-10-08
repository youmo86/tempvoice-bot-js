FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
    && mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node src ./src
USER node
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
