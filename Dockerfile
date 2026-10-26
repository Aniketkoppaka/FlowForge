# Multi-stage Dockerfile for FlowForge Monorepo
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl wget
WORKDIR /app

FROM base AS builder
WORKDIR /app
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci
RUN npm --workspace=@flowforge/database run db:generate
RUN npm run build

# Stage: Migration runner (one-time job)
FROM base AS migration
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY packages/database ./packages/database
RUN npm ci --omit=dev
RUN npm --workspace=@flowforge/database run db:generate
ENTRYPOINT ["npm", "--workspace=@flowforge/database", "run", "db:migrate:deploy"]

# Stage: API service
FROM base AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

# Stage: Worker service
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker ./apps/worker
CMD ["node", "apps/worker/dist/index.js"]
