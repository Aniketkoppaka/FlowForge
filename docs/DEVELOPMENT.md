# Local Development Guide (`docs/DEVELOPMENT.md`)

## 1. Prerequisites

- **Node.js**: `>= 20.0.0` (tested on `v24.11.0` and `v22.x`)
- **npm**: `>= 10.0.0` (uses npm workspaces + Turborepo)
- **Docker & Docker Compose**: Required for local PostgreSQL 16 and Redis 7 containers

---

## 2. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Scope | Default (Dev/Test) | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | `api`, `worker`, `database` | `postgresql://flowforge:flowforge_dev_password@localhost:5432/flowforge?schema=public` | PostgreSQL connection URL |
| `REDIS_URL` | `worker` | `redis://localhost:6379` | Redis connection URL |
| `API_PORT` | `api` | `4000` | HTTP port for `@flowforge/api` |
| `NODE_ENV` | All | `development` | `development \| test \| production` |
| `CORS_ORIGIN` | `api` | `http://localhost:3000` | Comma-separated explicit origins (`*` is rejected) |
| `SESSION_SECRET` | `api` | Dev fallback (Required $\ge 32$ chars in `production`) | Secret for `HS256` JWT session signing |
| `CSRF_SECRET` | `api` | Dev fallback (Required $\ge 32$ chars in `production`) | Secret for HMAC Double-Submit CSRF tokens |
| `NEXT_PUBLIC_API_URL` | `web` | `http://localhost:4000` | Base URL for browser API requests |
| `ENABLE_OUTBOUND_HTTP` | `worker` | `"false"` | Enables SSRF-hardened `http_request` handler when `"true"` |
| `WORKER_CONCURRENCY` | `worker` | `4` | Max concurrent runs per worker process (`1..20`) |

---

## 3. Workspace Commands

| Command | Description |
| :--- | :--- |
| `npm ci` | Clean install from `package-lock.json` |
| `npm run db:generate` | Generates the Prisma Client in `@flowforge/database` |
| `npm run db:migrate:deploy` | Applies all committed SQL migrations (`20261021000000_init`, `20261021010000_add_session_revocation`, `20261021160000_add_versions_runs_outbox`) |
| `npm run lint` | Runs ESLint across all 7 workspace packages |
| `npm run typecheck` | Runs `tsc --noEmit` across all 7 workspace packages |
| `npm run test` | Runs Vitest unit, API, engine, worker, and frontend suites |
| `npm run build` | Builds all packages and runs the production Next.js build |
| `npm run dev` | Starts API (`:4000`), Web (`:3000`), and Worker in watch mode |

---

## 4. End-to-End Demonstration Walkthrough

1. Sign in or register a developer account on `http://localhost:3000`.
2. Create a workflow named **"Enterprise Order Router"** and click **Create & Open Editor**.
3. In the left **Node Palette**:
   - Click **+ Add** on **Manual Trigger**.
   - Click **+ Add** on **Condition** and configure:
     - **Left Operand**: `trigger.payload.tier`
     - **Operator**: `equals`
     - **Right Operand**: `vip`
   - Click **+ Add** on **Data Transform** (rename to `VIP Enrichment`, map `trigger.payload.orderId` $\rightarrow$ `vipOrderId`).
   - Click **+ Add** on a second **Data Transform** (rename to `Standard Enrichment`, map `trigger.payload.orderId` $\rightarrow$ `stdOrderId`).
4. Connect `Manual Trigger` $\rightarrow$ `Condition`, `Condition (TRUE)` $\rightarrow$ `VIP Enrichment`, and `Condition (FALSE)` $\rightarrow$ `Standard Enrichment`.
5. Click **Save Draft**, refresh the browser, and verify the entire graph and node positions are restored.
6. Click **Publish Version** to create immutable **Published v1**.
7. Click **Run v1** to queue an execution run and open the **Execution Inspector** panel on the right to inspect node statuses (`COMPLETED` vs `SKIPPED` branch) and outputs.
