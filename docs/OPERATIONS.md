# Operations, Queue Reliability & Troubleshooting (`docs/OPERATIONS.md`)

## 1. Transactional Outbox & Delivery Guarantees

FlowForge uses a **Transactional Outbox** pattern (`OutboxEvent` table in PostgreSQL) rather than dual-writing to PostgreSQL and Redis without a transaction:

1. **Atomic Creation**: `POST /api/workflows/:id/runs` inserts the `WorkflowRun`, initial `NodeExecution` rows, and an `OutboxEvent` (`status = 'PENDING'`) inside a single PostgreSQL transaction.
2. **Lease-Based Claiming**: Dispatchers/workers claim pending events using optimistic concurrency (`attempts = candidate.attempts`) and set `status = 'PROCESSING'`, `lockedBy = workerId`, and `lockedUntil = now + leaseDurationMs`.
3. **Crash & Abandoned Lease Recovery**: If a dispatcher or worker crashes while `status = 'PROCESSING'`, once `lockedUntil <= now()` another worker automatically reclaims the event.
4. **Bounded Retries & Poison Event Protection**: Failed deliveries increment `attempts` and schedule `nextAttemptAt` using exponential backoff with jitter (`computeOutboxBackoffMs`). Once `attempts >= maxAttempts` (default `5`), the event transitions to `DEAD_LETTER` so poison events never loop infinitely.
5. **At-Least-Once Semantics & Worker Fencing**:
   - External side effects are **at-least-once** if a worker crashes after an external operation but before committing run completion.
   - Database state transitions are **idempotent and fenced**: `completeRunExecution` requires `status = 'RUNNING'`, `workerLeaseOwner = workerId`, and `attemptCount = attemptNumber`. A stale worker whose lease expired cannot overwrite a newer worker's attempt or revert a `CANCELLED`/`COMPLETED` run.

---

## 2. Database Migrations & Retention Policy

- **Forward-Only Migrations**: Never edit applied migrations (`20261021000000_init`, `20261021010000_add_session_revocation`, `20261021160000_add_versions_runs_outbox`). Always apply migrations in production using `npm run db:migrate:deploy`.
- **Audit History Protection**:
  - `Workflow` deletion uses soft archival (`deletedAt = now()`).
  - Foreign keys from `Workflow`, `WorkflowVersion`, and `WorkflowRun` use `ON DELETE RESTRICT` to prevent accidental cascade destruction of historical versions and execution audit logs.

---

## 3. Health Checks & Monitoring

- **`GET /api/health`**: Returns `{ status: "ok", service: "@flowforge/api", outbox: { pendingCount, processingCount, deliveredCount, deadLetterCount } }`.
- Monitor `outbox.deadLetterCount > 0` or sustained growth in `outbox.pendingCount` as primary operational alerts.
