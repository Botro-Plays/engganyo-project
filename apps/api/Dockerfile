# Build from the repository root so npm uses the workspace lockfile.
FROM node:24-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci && npm cache clean --force
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm run db:generate --workspace=apps/api && npm run build --workspace=apps/api

FROM node:24-alpine AS production
RUN apk add --no-cache dumb-init openssl su-exec
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
WORKDIR /app/apps/api
COPY --from=builder --chown=nestjs:nodejs /app/node_modules /app/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/tsconfig.base.json /app/tsconfig.base.json
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./package.json
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/tsconfig.seed.json ./tsconfig.seed.json
RUN mkdir -p uploads logs && chown -R nestjs:nodejs uploads logs
COPY --chmod=755 apps/api/entrypoint.sh /app/entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/app/entrypoint.sh"]
