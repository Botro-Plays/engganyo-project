# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Install all dependencies (dev needed for build)
COPY package*.json ./
RUN npm install && npm cache clean --force

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build
RUN npm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:24-alpine AS production

RUN apk add --no-cache dumb-init openssl su-exec

ENV NODE_ENV=production
WORKDIR /app

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Create directories with proper permissions (Docker volumes inherit these on first mount)
RUN mkdir -p /app/logs /app/uploads && \
    chown -R nestjs:nodejs /app/logs /app/uploads

# Copy only what's needed
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

COPY --chmod=755 entrypoint.sh /app/entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/app/entrypoint.sh"]
