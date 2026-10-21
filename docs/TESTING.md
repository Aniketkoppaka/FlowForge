# Testing & Verification Guide (`docs/TESTING.md`)

## 1. Test Suite Architecture

FlowForge uses **Vitest** across all packages and **React Testing Library / Supertest** for component and API integration verification.

| Suite | File | Executed Tests | Skipped Tests | Coverage Focus |
| :--- | :--- | :---: | :---: | :--- |
| `@flowforge/contracts` | `packages/contracts/src/contracts.test.ts` | **12** | 0 | Auth schemas, 4 node types, DAG connection rules, `DraftDefinitionSchema` vs. `validateWorkflowExecutionReadiness`, corrupted draft detection |
| `@flowforge/workflow-engine` | `packages/workflow-engine/src/index.test.ts` | **14** | 0 | Safe path resolution, prototype pollution defense, condition operators, linear data flow, `true`/`false` branching + `SKIPPED` cascade, fail-closed HTTP, SSRF IP/URL/DNS rebinding regression suite |
| `@flowforge/api` (In-Memory) | `apps/api/src/app.test.ts` | **17** | 0 | Registration, login, server-side session revocation, CSRF, CORS, rate limit, ownership isolation, graph validation, immutable version publishing, version pinning, idempotency keys, outbox dead-lettering, stale worker lease fencing |
| `@flowforge/api` (Live PostgreSQL) | `apps/api/src/prisma-integration.test.ts` | **0 locally** (**3 in CI**) | **3 locally** | Real PostgreSQL persistence, session revocation, `Restrict` FK verification, and end-to-end publish $\rightarrow$ outbox $\rightarrow$ worker $\rightarrow$ run persistence (`RUN_DB_INTEGRATION_TESTS="true"`) |
| `@flowforge/web` | `apps/web/src/app/page.test.tsx` | **8** | 0 | Dashboard workflow creation, visual editor node addition/configuration/save/reload, save error recovery, Corrupted Draft Protection lock & repair, version publish + run execution inspector with `SKIPPED` branch |
| `@flowforge/worker` | `apps/worker/src/index.test.ts` | **3** | 0 | Worker metadata, exponential backoff with jitter, `FlowForgeWorkerRuntime` lifecycle and concurrency bounds |
| `@flowforge/database` | `packages/database/src/index.test.ts` | **1** | 0 | Prisma client initialization and export verification |
| **Total** | **7 Test Files** | **55 Passed** | **3 Skipped Locally** | **0 Failed** |

---

## 2. Running the Verification Suite

```bash
# Run all unit, engine, worker, API, and frontend tests
npm run test

# Run linter and TypeScript typecheck across all 7 packages
npm run lint
npm run typecheck

# Run full production build
npm run build
```

### Running the Live PostgreSQL Integration Suite
When a disposable PostgreSQL instance is running (via `docker compose up -d` or in GitHub Actions CI):
```bash
npm run db:generate
npm run db:migrate:deploy
RUN_DB_INTEGRATION_TESTS=true npm run test
```
> **Note**: In `.github/workflows/ci.yml`, `RUN_DB_INTEGRATION_TESTS="true"` is enforced with a pre-check so the PostgreSQL integration suite cannot be silently skipped in CI.
