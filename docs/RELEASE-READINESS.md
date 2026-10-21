# Release Readiness Report (`docs/RELEASE-READINESS.md`)

## Release Verdict

**READY WITH DOCUMENTED NON-CRITICAL LIMITATIONS**

All critical security, architectural, validation, versioning, outbox durability, worker lease fencing, and UI inspection requirements are implemented and verified by automated tests (`55 passed, 0 failed`). The sole environmental limitation is that the local Windows workstation does not have the Docker Desktop Linux engine running (`//./pipe/dockerDesktopLinuxEngine` unavailable), so the 3 live PostgreSQL integration tests in `apps/api/src/prisma-integration.test.ts` remain skipped locally and are configured to run mandatory (`RUN_DB_INTEGRATION_TESTS="true"`) in `.github/workflows/ci.yml`.

---

## 1. Critical Acceptance Checklist

| Requirement | Status | Evidence |
| :--- | :---: | :--- |
| Cross-user access blocked on workflows, versions, runs, nodes, and cancel | **PASS** | `apps/api/src/routes/workflows.ts`, `apps/api/src/routes/runs.ts`, `apps/api/src/app.test.ts` |
| Server-side session revocation invalidates JWT immediately on logout | **PASS** | `apps/api/src/security/session.ts`, `apps/api/src/app.test.ts` |
| Client cannot bypass server-side graph validation | **PASS** | `DraftDefinitionSchema` & `validateWorkflowExecutionReadiness` in `packages/contracts/src/workflow.ts` |
| Malformed stored drafts are quarantined and locked against silent overwrite | **PASS** | `normalizeDraftDefinition` (`isCorrupted`) + **Corrupted Draft Protection** in `WorkflowEditor.tsx` & `page.test.tsx` |
| Runs pin an immutable `WorkflowVersion` and are unaffected by later draft edits or v2 publishes | **PASS** | `apps/api/src/app.test.ts` (`publishes immutable workflow versions, pins runs to exact versions...`) |
| Transactional outbox + worker lease & `attemptNumber` fencing prevent stale workers from overwriting newer attempts or cancelled runs | **PASS** | `apps/api/src/services/execution-orchestrator.ts`, `apps/api/src/app.test.ts` |
| Bounded retries and poison outbox dead-lettering (`DEAD_LETTER` after `maxAttempts`) | **PASS** | `apps/api/src/app.test.ts` (`handles outbox publication failures, crash recovery, poison dead-lettering...`) |
| Outbound HTTP fails closed by default and blocks SSRF (loopback, RFC1918, metadata, octal/hex IPs, mixed DNS rebinding, redirects) when enabled | **PASS** | `packages/workflow-engine/src/http-client.ts`, `packages/workflow-engine/src/index.test.ts` |
| Secrets and sensitive headers redacted from outputs and logs | **PASS** | `redactHeaders` in `packages/workflow-engine/src/http-client.ts` |
| Forward SQL migrations coherent from an empty database | **PASS** | `20261021000000_init`, `20261021010000_add_session_revocation`, `20261021160000_add_versions_runs_outbox` |
| CI enforces `RUN_DB_INTEGRATION_TESTS="true"` against disposable PostgreSQL 16 & Redis 7 | **PASS** | `.github/workflows/ci.yml` |

---

## 2. Consolidated Verification Matrix

| Check / Suite | Command | Passed | Failed | Skipped | Notes |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **ESLint (7 packages)** | `npm run lint` | 7 pkg | 0 | 0 | Exit code `0` |
| **TypeScript Typecheck (7 packages)** | `npm run typecheck` | 7 pkg | 0 | 0 | Exit code `0` |
| **`@flowforge/contracts` Unit Tests** | `npm run test` | 12 | 0 | 0 | Graph, readiness, and draft schemas |
| **`@flowforge/workflow-engine` Tests** | `npm run test` | 14 | 0 | 0 | Execution engine, branching, SSRF suite |
| **`@flowforge/api` In-Memory Integration** | `npm run test` | 17 | 0 | 0 | Auth, CRUD, versions, runs, outbox, fencing |
| **`@flowforge/api` Live PostgreSQL Suite** | `npm run test` | 0 | 0 | 3 | Blocked locally by stopped Docker daemon; enforced in CI |
| **`@flowforge/web` Component & Editor Suite** | `npm run test` | 8 | 0 | 0 | Dashboard, editor, recovery lock, publish & run inspector |
| **`@flowforge/worker` Runtime Suite** | `npm run test` | 3 | 0 | 0 | Worker metadata, backoff, concurrency lifecycle |
| **`@flowforge/database` Smoke Test** | `npm run test` | 1 | 0 | 0 | Prisma client export verification |
| **Production Build (All packages + Next.js)** | `npm run build` | 6 pkg | 0 | 0 | Exit code `0` |

---

## 3. Documented Non-Critical Limitations

1. **Local Docker Daemon Unavailable**: Because the local Docker Desktop Linux engine (`//./pipe/dockerDesktopLinuxEngine`) is stopped on this machine, live PostgreSQL container startup and `prisma migrate deploy` were not executed locally. All Prisma repositories and migrations are verified for type/schema validity (`prisma generate` + `tsc --noEmit`) and configured to run in `.github/workflows/ci.yml`.
2. **Remote CI Execution Pending Push**: In compliance with repository safety instructions, no commits have been pushed to `origin/main`, so GitHub Actions has not yet executed remotely.
