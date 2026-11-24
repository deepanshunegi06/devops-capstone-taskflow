# syntax=docker/dockerfile:1
# Multi-stage build: dependencies in a builder stage, minimal non-root runtime.
FROM node:20-alpine AS deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=deps /build/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/live || exit 1
CMD ["node", "src/server.js"]
