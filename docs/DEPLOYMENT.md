# Deployment Guide (`docs/DEPLOYMENT.md`)

## 1. Required Production Services

A complete FlowForge production deployment requires four components:
1. **PostgreSQL 16+**: Authoritative persistence store for users, sessions, workflows, immutable versions, execution history, and transactional outbox events.
2. **Redis 7+**: Coordination store (`docker-compose.yml` / managed Redis).
3. **`@flowforge/api` (`apps/api`)**: Stateless Node.js HTTP API server (`NODE_ENV="production"`).
4. **`@flowforge/worker` (`apps/worker`)**: Persistent long-running background worker process (`NODE_ENV="production"`). **Do not deploy `@flowforge/worker` to a scale-to-zero request-only serverless function**; it requires a persistent container/VM process.
5. **`@flowforge/web` (`apps/web`)**: Next.js 15 frontend (`next build && next start`).

---

## 2. Production Environment Variables

In `NODE_ENV="production"`, `@flowforge/api` fails fast at startup if `SESSION_SECRET` or `CSRF_SECRET` are missing or shorter than 32 characters, or if `CORS_ORIGIN` contains `*`.

```bash
NODE_ENV="production"
DATABASE_URL="postgresql://<user>:<password>@<db-host>:5432/flowforge?schema=public&sslmode=require"
REDIS_URL="rediss://<user>:<password>@<redis-host>:6379"

API_PORT=4000
CORS_ORIGIN="https://app.example.com"
SESSION_SECRET="<64-char-cryptographically-random-hex>"
CSRF_SECRET="<64-char-cryptographically-random-hex>"

NEXT_PUBLIC_API_URL="https://api.example.com"

WORKER_CONCURRENCY=4
WORKER_POLL_INTERVAL_MS=1500
WORKER_LEASE_DURATION_MS=60000
ENABLE_OUTBOUND_HTTP="false" # Set to "true" only when outbound HTTP execution is desired
```

---

## 3. Build, Migration & Startup Sequence

```bash
# 1. Install locked dependencies
npm ci

# 2. Generate Prisma Client & build all packages
npm run build

# 3. Apply forward database migrations before starting new API/worker instances
npm run db:migrate:deploy

# 4. Start API process
npm --workspace=@flowforge/api run start

# 5. Start Worker process
node apps/worker/dist/index.js

# 6. Start Web frontend
npm --workspace=@flowforge/web run start
```

---

## 4. Network & Egress Hardening

- **HTTPS**: Terminate TLS at the ingress/load balancer so `Secure` session and CSRF cookies are transmitted exclusively over HTTPS.
- **Database & Redis Isolation**: Place PostgreSQL and Redis in private subnets with no public internet ingress.
- **Worker Egress Firewall**: In addition to FlowForge's application-layer SSRF checks (`packages/workflow-engine/src/http-client.ts`), restrict worker container egress at the VPC/firewall layer to block RFC1918 and cloud metadata (`169.254.169.254`) destinations.
