import type {
  WorkflowRunStatus,
  NodeExecutionStatusContract,
  WorkflowNodeType
} from "@flowforge/contracts";

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  jti: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface WorkflowRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  draftDefinition: unknown;
  publishedVersionId: string | null;
  publishedVersionNumber: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  versionNumber: number;
  contentHash: string;
  definition: unknown;
  createdAt: Date;
}

export interface NodeExecutionRecordEntity {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: WorkflowNodeType;
  label: string;
  status: NodeExecutionStatusContract;
  attemptCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  selectedBranch: "true" | "false" | null;
  skipReason: string | null;
  error: {
    code: string;
    message: string;
    nodeId?: string;
    details?: unknown;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionAttemptRecord {
  id: string;
  runId: string;
  attemptNumber: number;
  workerId: string;
  status: WorkflowRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  error: unknown | null;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  versionNumber: number;
  userId: string;
  status: WorkflowRunStatus;
  triggerPayload: Record<string, unknown>;
  idempotencyKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  workerLeaseOwner: string | null;
  workerLeaseUntil: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  durationMs: number | null;
  error: {
    code: string;
    message: string;
    nodeId?: string;
    details?: unknown;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export type OutboxStatus = "PENDING" | "PROCESSING" | "DELIVERED" | "DEAD_LETTER";

export interface OutboxEventRecord {
  id: string;
  eventType: "WORKFLOW_RUN_CREATED";
  aggregateId: string;
  payload: {
    runId: string;
    workflowId: string;
    workflowVersionId: string;
    userId: string;
  };
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  deliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(data: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<UserRecord>;
}

export interface SessionRepository {
  create(data: {
    jti: string;
    userId: string;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  findActiveByJti(jti: string, now?: Date): Promise<SessionRecord | null>;
  revokeByJti(jti: string): Promise<boolean>;
}

export interface PublishVersionResult {
  workflow: WorkflowRecord;
  version: WorkflowVersionRecord;
  alreadyPublished: boolean;
}

export interface CreateRunWithOutboxResult {
  run: WorkflowRunRecord;
  outboxEvent: OutboxEventRecord | null;
  reusedIdempotentRun: boolean;
  idempotencyConflict?: boolean;
}

export interface WorkflowRepository {
  create(data: {
    userId: string;
    name: string;
    description?: string | null;
    draftDefinition?: unknown;
  }): Promise<WorkflowRecord>;
  findActiveByUserId(userId: string): Promise<WorkflowRecord[]>;
  findActiveByIdAndUserId(id: string, userId: string): Promise<WorkflowRecord | null>;
  updateActiveByIdAndUserId(
    id: string,
    userId: string,
    data: {
      name?: string;
      description?: string | null;
      draftDefinition?: unknown;
    }
  ): Promise<WorkflowRecord | null>;
  softDeleteByIdAndUserId(id: string, userId: string): Promise<boolean>;

  // Versioning
  publishVersion(data: {
    workflowId: string;
    userId: string;
    contentHash: string;
    definition: unknown;
  }): Promise<PublishVersionResult | null>;
  listVersionsByWorkflowIdAndUserId(
    workflowId: string,
    userId: string
  ): Promise<WorkflowVersionRecord[]>;
  findVersionById(
    workflowId: string,
    versionId: string
  ): Promise<WorkflowVersionRecord | null>;
}

export interface ExecutionRepository {
  /**
   * Atomically creates a QUEUED WorkflowRun, initializes PENDING NodeExecutions for all
   * nodes in the pinned version, and creates a PENDING OutboxEvent.
   * If `idempotencyKey` matches an existing run for `(userId, workflowId)`:
   * - If `triggerPayload` and `workflowVersionId` match, returns the existing run (`reusedIdempotentRun: true`).
   * - If they differ, returns `idempotencyConflict: true`.
   */
  createRunWithOutbox(data: {
    workflowId: string;
    workflowVersionId: string;
    versionNumber: number;
    userId: string;
    triggerPayload: Record<string, unknown>;
    idempotencyKey?: string | null;
    maxAttempts?: number;
    initialNodes: ReadonlyArray<{
      nodeId: string;
      nodeType: WorkflowNodeType;
      label: string;
    }>;
  }): Promise<CreateRunWithOutboxResult>;

  findRunByIdAndUserId(
    runId: string,
    userId: string
  ): Promise<{
    run: WorkflowRunRecord;
    nodeExecutions: NodeExecutionRecordEntity[];
  } | null>;

  listRunsByWorkflowIdAndUserId(
    workflowId: string,
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ runs: WorkflowRunRecord[]; total: number }>;

  cancelRunByIdAndUserId(
    runId: string,
    userId: string,
    now?: Date
  ): Promise<WorkflowRunRecord | null>;

  /**
   * Worker claim / lease acquisition:
   * Claims a QUEUED (or RUNNING with expired workerLeaseUntil) run if attemptCount < maxAttempts.
   * Increments `attemptCount`, sets `status = 'RUNNING'`, records an `ExecutionAttempt`,
   * and returns the claimed run + pinned version definition.
   * Returns `null` if the run is already COMPLETED/FAILED/CANCELLED, leased by an active worker,
   * or has exhausted `maxAttempts`.
   */
  claimRunForExecution(data: {
    runId: string;
    workerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<{
    run: WorkflowRunRecord;
    version: WorkflowVersionRecord;
    attemptNumber: number;
  } | null>;

  /**
   * Completes or fails a run only if the caller still holds `workerLeaseOwner === workerId`
   * and the run has not been `CANCELLED` or superseded by a newer attempt.
   */
  completeRunExecution(data: {
    runId: string;
    workerId: string;
    attemptNumber: number;
    status: "COMPLETED" | "FAILED";
    completedAt: Date;
    durationMs: number;
    error?: {
      code: string;
      message: string;
      nodeId?: string;
      details?: unknown;
    } | null;
    nodeResults: ReadonlyArray<{
      nodeId: string;
      nodeType: WorkflowNodeType;
      label: string;
      status: NodeExecutionStatusContract;
      startedAt: Date | null;
      completedAt: Date | null;
      durationMs: number | null;
      input: Record<string, unknown> | null;
      output: Record<string, unknown> | null;
      selectedBranch?: "true" | "false" | null;
      skipReason?: string | null;
      error?: {
        code: string;
        message: string;
        nodeId?: string;
        details?: unknown;
      } | null;
    }>;
  }): Promise<WorkflowRunRecord | null>;

  // Transactional Outbox Operations
  claimPendingOutboxEvents(data: {
    dispatcherId: string;
    limit: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord[]>;

  markOutboxEventDelivered(data: {
    eventId: string;
    dispatcherId: string;
    now?: Date;
  }): Promise<boolean>;

  markOutboxEventFailed(data: {
    eventId: string;
    dispatcherId: string;
    errorMessage: string;
    retryDelayMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord | null>;

  getOutboxMetrics(now?: Date): Promise<{
    pendingCount: number;
    processingCount: number;
    deliveredCount: number;
    deadLetterCount: number;
  }>;
}
