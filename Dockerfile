# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# -----------------------------------------------------------------------------
# Frontend build
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Backend build
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS backend-builder
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ ./
RUN npm run build

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app/server

# Install production dependencies only
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Copy built backend, migrations, and frontend assets
COPY --from=backend-builder /app/server/dist ./dist
COPY --from=backend-builder /app/server/migrations ./migrations
COPY --from=frontend-builder /app/dist ../dist

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SQLITE_PATH=file:./data/kanban.db
ENV BUZZ_VERIFY_SIGNATURES=true

EXPOSE 3000

VOLUME ["/app/server/data"]

CMD ["node", "dist/server.js"]
