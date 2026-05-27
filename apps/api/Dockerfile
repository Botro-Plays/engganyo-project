# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy root lockfile + both workspace package.json files
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

# Install only API workspace deps (uses root lockfile)
RUN npm ci --workspace=apps/api && npm cache clean --force

# Copy API source
COPY apps/api/ ./apps/api/

# Generate Prisma client and build
RUN cd apps/api && npx prisma generate && npm run build

# ─── Production Stage ─────────────────────────────────────────────────────────
FROM node:24-alpine AS production

RUN apk add --no-cache dumb-init openssl

ENV NODE_ENV=production
WORKDIR /app

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Create logs directory with proper permissions
RUN mkdir -p /app/logs && \
    chown -R nestjs:nodejs /app/logs

# node_modules are hoisted to root; dist/prisma are in apps/api/
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./package.json

USER nestjs

EXPOSE 3001

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
