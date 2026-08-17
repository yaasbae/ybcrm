FROM node:20-slim

# Install build tools for native modules (sharp, better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDeps for tsx)
RUN npm ci

# Copy source
COPY . .

# Build frontend
ARG FRONTEND_BUILD_CACHE_BUST=2026-08-17-yandex-split
RUN echo "frontend build cache bust: ${FRONTEND_BUILD_CACHE_BUST}" && npm run build

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

ENV NODE_ENV=production

CMD ["npx", "tsx", "server.ts"]
