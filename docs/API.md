# API Reference (`docs/API.md`)

All state-changing endpoints (`POST`, `PATCH`, `DELETE`) except `/api/auth/register` and `/api/auth/login` require:
- Valid `ff_session` `HttpOnly` cookie (backed by an active, unrevoked row in `Session`).
- Valid `ff_csrf` cookie and matching `X-CSRF-Token` request header.

All error responses return a consistent envelope:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

---

## 1. Health & Authentication

### `GET /api/health`
Returns service status and transactional outbox metrics (`pendingCount`, `processingCount`, `deliveredCount`, `deadLetterCount`).

### `POST /api/auth/register`
Creates a new user account, hashes the password with Argon2id, persists a `Session` record, and sets `ff_session` and `ff_csrf` cookies.
- **Status**: `201 Created` | `400 VALIDATION_ERROR` | `409 EMAIL_ALREADY_EXISTS` | `429 RATE_LIMITED`

### `POST /api/auth/login`
Authenticates an existing user with constant-time Argon2id verification and establishes a new server-side `Session`.
- **Status**: `200 OK` | `401 INVALID_CREDENTIALS` | `429 RATE_LIMITED`

### `POST /api/auth/logout`
Marks the current session's `jti` as revoked (`revokedAt = now()`) in PostgreSQL and clears browser cookies.
- **Status**: `200 OK` | `401 UNAUTHORIZED` | `403 CSRF_INVALID`

### `GET /api/auth/me`
Returns the authenticated user profile and a fresh `csrfToken`.
- **Status**: `200 OK` | `401 UNAUTHORIZED`

---

## 2. Workflows & Immutable Versioning

### `POST /api/workflows`
Creates a new workflow owned by the authenticated user. Validates `draftDefinition` via `DraftDefinitionSchema`.
- **Status**: `201 Created` | `400 VALIDATION_ERROR`

### `GET /api/workflows`
Lists all active (non-archived) workflows owned by the authenticated user, ordered by `updatedAt DESC`.
- **Status**: `200 OK`

### `GET /api/workflows/:id`
Retrieves a single active workflow owned by the authenticated user. Returns `404 NOT_FOUND` if nonexistent, archived, or owned by another user.
- **Status**: `200 OK` | `404 NOT_FOUND`

### `PATCH /api/workflows/:id`
Updates `name`, `description`, and/or `draftDefinition` (validated via `DraftDefinitionSchema`). Does not mutate previously published `WorkflowVersion` rows.
- **Status**: `200 OK` | `400 VALIDATION_ERROR` | `404 NOT_FOUND`

### `DELETE /api/workflows/:id`
Soft-deletes (`deletedAt = now()`) the workflow while preserving historical versions and execution audit records.
- **Status**: `204 No Content` | `404 NOT_FOUND`

### `POST /api/workflows/:id/publish`
Validates the workflow's `draftDefinition` with `validateWorkflowExecutionReadiness`, computes the canonical `SHA-256` `contentHash`, and creates an immutable `WorkflowVersion`.
- If the current published version already has the identical `contentHash`, returns `200 OK` with `alreadyPublished: true`.
- Otherwise increments `versionNumber` atomically and returns `201 Created`.
- **Status**: `201 Created` | `200 OK` | `400 PUBLISH_VALIDATION_ERROR` | `404 NOT_FOUND`

### `GET /api/workflows/:id/versions`
Lists all immutable published versions for the workflow (`versionNumber DESC`).
- **Status**: `200 OK` | `404 NOT_FOUND`

---

## 3. Asynchronous Execution & Run Inspection

### `POST /api/workflows/:id/runs`
Queues an asynchronous execution run pinned to `versionId` (or the workflow's current `publishedVersionId`). Atomically writes the `WorkflowRun`, `PENDING` `NodeExecution` records, and an `OutboxEvent`.
- Supports `idempotencyKey` in body or `X-Idempotency-Key` header (scoped to `(userId, workflowId)`).
- Reusing the same key with identical `versionId` and `triggerPayload` returns `200 OK` (`reusedIdempotentRun: true`).
- Reusing the same key with different parameters returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- **Status**: `202 Accepted` | `200 OK` | `400 WORKFLOW_NOT_PUBLISHED` | `409 IDEMPOTENCY_KEY_CONFLICT` | `404 NOT_FOUND`

### `GET /api/workflows/:id/runs?limit=20&offset=0`
Lists execution runs for the workflow with bounded pagination (`limit` capped at `100`).
- **Status**: `200 OK` | `404 NOT_FOUND`

### `GET /api/runs/:id`
Retrieves a run's status, timestamps, duration, pinned `versionNumber`, structured error, and ordered `nodeExecutions`. Ownership-scoped (`404 NOT_FOUND` if owned by another user).
- **Status**: `200 OK` | `404 NOT_FOUND`

### `GET /api/runs/:id/nodes`
Retrieves node-level execution records for a run.
- **Status**: `200 OK` | `404 NOT_FOUND`

### `POST /api/runs/:id/cancel`
Cancels a `QUEUED` or `RUNNING` run, clearing its active worker lease so any in-flight worker is fenced out from overwriting the `CANCELLED` state.
- **Status**: `200 OK` | `404 NOT_FOUND`
