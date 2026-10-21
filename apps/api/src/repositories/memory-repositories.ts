import { randomUUID } from "node:crypto";
import type {
  UserRepository,
  SessionRepository,
  WorkflowRepository,
  ExecutionRepository,
  UserRecord,
  SessionRecord,
  WorkflowRecord,
  WorkflowVersionRecord,
  WorkflowRunRecord,
  NodeExecutionRecordEntity,
  ExecutionAttemptRecord,
  OutboxEventRecord,
  PublishVersionResult,
  CreateRunWithOutboxResult
} from "./types.js";

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) {
        return { ...user };
      }
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async create(data: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<UserRecord> {
    const normalized = data.email.toLowerCase();
    const existing = await this.findByEmail(normalized);
    if (existing) {
      const err = new Error("Unique constraint failed on the fields: (`email`)") as Error & {
        code?: string;
      };
      err.code = "P2002";
      throw err;
    }

    const now = new Date();
    const record: UserRecord = {
      id: randomUUID(),
      email: normalized,
      name: data.name ?? null,
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now
    };
    this.users.set(record.id, record);
    return { ...record };
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private sessionsByJti = new Map<string, SessionRecord>();

  async create(data: {
    jti: string;
    userId: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    if (this.sessionsByJti.has(data.jti)) {
      const err = new Error("Unique constraint failed on the fields: (`jti`)") as Error & {
        code?: string;
      };
      err.code = "P2002";
      throw err;
    }

    const record: SessionRecord = {
      id: randomUUID(),
      jti: data.jti,
      userId: data.userId,
      expiresAt: new Date(data.expiresAt.getTime()),
      revokedAt: null,
      createdAt: new Date()
    };
    this.sessionsByJti.set(data.jti, record);
    return { ...record };
  }

  async findActiveByJti(jti: string, now: Date = new Date()): Promise<SessionRecord | null> {
    const record = this.sessionsByJti.get(jti);
    if (!record) {
      return null;
    }
    if (record.revokedAt !== null) {
      return null;
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    return { ...record };
  }

  async revokeByJti(jti: string): Promise<boolean> {
    const record = this.sessionsByJti.get(jti);
    if (!record || record.revokedAt !== null) {
      return false;
    }
    record.revokedAt = new Date();
    this.sessionsByJti.set(jti, record);
    return true;
  }
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private workflows = new Map<string, WorkflowRecord>();
  private versions = new Map<string, WorkflowVersionRecord>();

  async create(data: {
    userId: string;
    name: string;
    description?: string | null;
    draftDefinition?: unknown;
  }): Promise<WorkflowRecord> {
    const now = new Date();
    const defaultDraft = { schemaVersion: 1, nodes: [], edges: [] };
    const record: WorkflowRecord = {
      id: randomUUID(),
      userId: data.userId,
      name: data.name,
      description: data.description ?? null,
      draftDefinition: data.draftDefinition
        ? structuredClone(data.draftDefinition)
        : defaultDraft,
      publishedVersionId: null,
      publishedVersionNumber: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.workflows.set(record.id, record);
    return { ...record };
  }

  async findActiveByUserId(userId: string): Promise<WorkflowRecord[]> {
    const list: WorkflowRecord[] = [];
    for (const wf of this.workflows.values()) {
      if (wf.userId === userId && wf.deletedAt === null) {
        list.push({ ...wf });
      }
    }
    return list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async findActiveByIdAndUserId(id: string, userId: string): Promise<WorkflowRecord | null> {
    const wf = this.workflows.get(id);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return null;
    }
    return { ...wf };
  }

  async updateActiveByIdAndUserId(
    id: string,
    userId: string,
    data: {
      name?: string;
      description?: string | null;
      draftDefinition?: unknown;
    }
  ): Promise<WorkflowRecord | null> {
    const wf = this.workflows.get(id);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...wf,
      name: data.name !== undefined ? data.name : wf.name,
      description: data.description !== undefined ? data.description : wf.description,
      draftDefinition:
        data.draftDefinition !== undefined
          ? structuredClone(data.draftDefinition)
          : wf.draftDefinition,
      updatedAt: new Date()
    };

    this.workflows.set(id, updated);
    return { ...updated };
  }

  async softDeleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const wf = this.workflows.get(id);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return false;
    }

    wf.deletedAt = new Date();
    wf.updatedAt = new Date();
    this.workflows.set(id, wf);
    return true;
  }

  async publishVersion(data: {
    workflowId: string;
    userId: string;
    contentHash: string;
    definition: unknown;
  }): Promise<PublishVersionResult | null> {
    const wf = this.workflows.get(data.workflowId);
    if (!wf || wf.userId !== data.userId || wf.deletedAt !== null) {
      return null;
    }

    // Policy: if the current published version already has the identical contentHash,
    // return it idempotently (`alreadyPublished: true`) without creating a redundant version row.
    if (wf.publishedVersionId) {
      const currentPub = this.versions.get(wf.publishedVersionId);
      if (currentPub && currentPub.contentHash === data.contentHash) {
        return {
          workflow: { ...wf },
          version: structuredClone(currentPub),
          alreadyPublished: true
        };
      }
    }

    let maxVersion = 0;
    for (const v of this.versions.values()) {
      if (v.workflowId === data.workflowId && v.versionNumber > maxVersion) {
        maxVersion = v.versionNumber;
      }
    }

    const nextVersionNumber = maxVersion + 1;
    const now = new Date();
    const versionRecord: WorkflowVersionRecord = {
      id: randomUUID(),
      workflowId: data.workflowId,
      versionNumber: nextVersionNumber,
      contentHash: data.contentHash,
      definition: structuredClone(data.definition),
      createdAt: now
    };
    this.versions.set(versionRecord.id, versionRecord);

    const updatedWf: WorkflowRecord = {
      ...wf,
      publishedVersionId: versionRecord.id,
      publishedVersionNumber: nextVersionNumber,
      updatedAt: now
    };
    this.workflows.set(updatedWf.id, updatedWf);

    return {
      workflow: { ...updatedWf },
      version: structuredClone(versionRecord),
      alreadyPublished: false
    };
  }

  async listVersionsByWorkflowIdAndUserId(
    workflowId: string,
    userId: string
  ): Promise<WorkflowVersionRecord[]> {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.userId !== userId || wf.deletedAt !== null) {
      return [];
    }
    const list: WorkflowVersionRecord[] = [];
    for (const v of this.versions.values()) {
      if (v.workflowId === workflowId) {
        list.push(structuredClone(v));
      }
    }
    return list.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async findVersionById(
    workflowId: string,
    versionId: string
  ): Promise<WorkflowVersionRecord | null> {
    const v = this.versions.get(versionId);
    if (!v || v.workflowId !== workflowId) {
      return null;
    }
    return structuredClone(v);
  }
}

export class InMemoryExecutionRepository implements ExecutionRepository {
  private runs = new Map<string, WorkflowRunRecord>();
  private nodeExecutionsByRun = new Map<string, Map<string, NodeExecutionRecordEntity>>();
  private attemptsByRun = new Map<string, ExecutionAttemptRecord[]>();
  private outboxEvents = new Map<string, OutboxEventRecord>();
  private workflowRepo: InMemoryWorkflowRepository;

  constructor(workflowRepo: InMemoryWorkflowRepository) {
    this.workflowRepo = workflowRepo;
  }

  async createRunWithOutbox(data: {
    workflowId: string;
    workflowVersionId: string;
    versionNumber: number;
    userId: string;
    triggerPayload: Record<string, unknown>;
    idempotencyKey?: string | null;
    maxAttempts?: number;
    initialNodes: ReadonlyArray<{
      nodeId: string;
      nodeType: NodeExecutionRecordEntity["nodeType"];
      label: string;
    }>;
  }): Promise<CreateRunWithOutboxResult> {
    const idemKey = data.idempotencyKey?.trim() || null;

    if (idemKey) {
      for (const existing of this.runs.values()) {
        if (
          existing.userId === data.userId &&
          existing.workflowId === data.workflowId &&
          existing.idempotencyKey === idemKey
        ) {
          const sameVersion = existing.workflowVersionId === data.workflowVersionId;
          const samePayload =
            JSON.stringify(existing.triggerPayload) ===
            JSON.stringify(data.triggerPayload);
          if (!sameVersion || !samePayload) {
            return {
              run: structuredClone(existing),
              outboxEvent: null,
              reusedIdempotentRun: false,
              idempotencyConflict: true
            };
          }
          return {
            run: structuredClone(existing),
            outboxEvent: null,
            reusedIdempotentRun: true
          };
        }
      }
    }

    const now = new Date();
    const runId = randomUUID();
    const runRecord: WorkflowRunRecord = {
      id: runId,
      workflowId: data.workflowId,
      workflowVersionId: data.workflowVersionId,
      versionNumber: data.versionNumber,
      userId: data.userId,
      status: "QUEUED",
      triggerPayload: structuredClone(data.triggerPayload),
      idempotencyKey: idemKey,
      attemptCount: 0,
      maxAttempts: data.maxAttempts ?? 3,
      workerLeaseOwner: null,
      workerLeaseUntil: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      durationMs: null,
      error: null,
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(runId, runRecord);

    const nodeMap = new Map<string, NodeExecutionRecordEntity>();
    for (const n of data.initialNodes) {
      nodeMap.set(n.nodeId, {
        id: randomUUID(),
        runId,
        nodeId: n.nodeId,
        nodeType: n.nodeType,
        label: n.label,
        status: "PENDING",
        attemptCount: 0,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        input: null,
        output: null,
        selectedBranch: null,
        skipReason: null,
        error: null,
        createdAt: now,
        updatedAt: now
      });
    }
    this.nodeExecutionsByRun.set(runId, nodeMap);
    this.attemptsByRun.set(runId, []);

    const outboxEvent: OutboxEventRecord = {
      id: randomUUID(),
      eventType: "WORKFLOW_RUN_CREATED",
      aggregateId: runId,
      payload: {
        runId,
        workflowId: data.workflowId,
        workflowVersionId: data.workflowVersionId,
        userId: data.userId
      },
      status: "PENDING",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      lockedBy: null,
      lockedUntil: null,
      deliveredAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now
    };
    this.outboxEvents.set(outboxEvent.id, outboxEvent);

    return {
      run: structuredClone(runRecord),
      outboxEvent: structuredClone(outboxEvent),
      reusedIdempotentRun: false
    };
  }

  async findRunByIdAndUserId(
    runId: string,
    userId: string
  ): Promise<{
    run: WorkflowRunRecord;
    nodeExecutions: NodeExecutionRecordEntity[];
  } | null> {
    const run = this.runs.get(runId);
    if (!run || run.userId !== userId) {
      return null;
    }
    const nodeMap = this.nodeExecutionsByRun.get(runId) ?? new Map();
    return {
      run: structuredClone(run),
      nodeExecutions: Array.from(nodeMap.values()).map((n) => structuredClone(n))
    };
  }

  async listRunsByWorkflowIdAndUserId(
    workflowId: string,
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ runs: WorkflowRunRecord[]; total: number }> {
    const limit = Math.min(Math.max(1, options?.limit ?? 20), 100);
    const offset = Math.max(0, options?.offset ?? 0);

    const matching: WorkflowRunRecord[] = [];
    for (const r of this.runs.values()) {
      if (r.workflowId === workflowId && r.userId === userId) {
        matching.push(structuredClone(r));
      }
    }
    matching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      runs: matching.slice(offset, offset + limit),
      total: matching.length
    };
  }

  async cancelRunByIdAndUserId(
    runId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<WorkflowRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run || run.userId !== userId) {
      return null;
    }

    if (
      run.status === "COMPLETED" ||
      run.status === "FAILED" ||
      run.status === "CANCELLED"
    ) {
      return structuredClone(run);
    }

    const updated: WorkflowRunRecord = {
      ...run,
      status: "CANCELLED",
      cancelledAt: now,
      completedAt: now,
      workerLeaseOwner: null,
      workerLeaseUntil: null,
      updatedAt: now
    };
    this.runs.set(runId, updated);

    const nodeMap = this.nodeExecutionsByRun.get(runId);
    if (nodeMap) {
      for (const [nodeId, nodeRec] of nodeMap.entries()) {
        if (nodeRec.status === "PENDING" || nodeRec.status === "RUNNING") {
          nodeMap.set(nodeId, {
            ...nodeRec,
            status: "CANCELLED",
            completedAt: now,
            updatedAt: now
          });
        }
      }
    }

    return structuredClone(updated);
  }

  async claimRunForExecution(data: {
    runId: string;
    workerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<{
    run: WorkflowRunRecord;
    version: WorkflowVersionRecord;
    attemptNumber: number;
  } | null> {
    const now = data.now ?? new Date();
    const run = this.runs.get(data.runId);
    if (!run) return null;

    if (
      run.status === "COMPLETED" ||
      run.status === "FAILED" ||
      run.status === "CANCELLED"
    ) {
      return null;
    }

    // If RUNNING and lease is still valid under another worker, reject duplicate claim
    if (
      run.status === "RUNNING" &&
      run.workerLeaseUntil &&
      run.workerLeaseUntil.getTime() > now.getTime() &&
      run.workerLeaseOwner !== data.workerId
    ) {
      return null;
    }

    if (run.attemptCount >= run.maxAttempts) {
      const exhausted: WorkflowRunRecord = {
        ...run,
        status: "FAILED",
        completedAt: now,
        workerLeaseOwner: null,
        workerLeaseUntil: null,
        error: {
          code: "MAX_ATTEMPTS_EXHAUSTED",
          message: `Run exceeded maximum execution attempts (${run.maxAttempts}).`
        },
        updatedAt: now
      };
      this.runs.set(run.id, exhausted);
      return null;
    }

    const version = await this.workflowRepo.findVersionById(
      run.workflowId,
      run.workflowVersionId
    );
    if (!version) return null;

    const nextAttempt = run.attemptCount + 1;
    const leaseUntil = new Date(now.getTime() + data.leaseDurationMs);
    const updatedRun: WorkflowRunRecord = {
      ...run,
      status: "RUNNING",
      attemptCount: nextAttempt,
      workerLeaseOwner: data.workerId,
      workerLeaseUntil: leaseUntil,
      startedAt: run.startedAt ?? now,
      updatedAt: now
    };
    this.runs.set(run.id, updatedRun);

    const attempts = this.attemptsByRun.get(run.id) ?? [];
    attempts.push({
      id: randomUUID(),
      runId: run.id,
      attemptNumber: nextAttempt,
      workerId: data.workerId,
      status: "RUNNING",
      startedAt: now,
      completedAt: null,
      error: null
    });
    this.attemptsByRun.set(run.id, attempts);

    return {
      run: structuredClone(updatedRun),
      version: structuredClone(version),
      attemptNumber: nextAttempt
    };
  }

  async completeRunExecution(data: {
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
      nodeType: NodeExecutionRecordEntity["nodeType"];
      label: string;
      status: NodeExecutionRecordEntity["status"];
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
  }): Promise<WorkflowRunRecord | null> {
    const run = this.runs.get(data.runId);
    if (!run) return null;

    // Fence stale workers: only the active lease owner on the current attemptNumber can commit results,
    // and terminal runs (COMPLETED, FAILED, CANCELLED) cannot be overwritten.
    if (
      run.status !== "RUNNING" ||
      run.workerLeaseOwner !== data.workerId ||
      run.attemptCount !== data.attemptNumber
    ) {
      return null;
    }

    const updatedRun: WorkflowRunRecord = {
      ...run,
      status: data.status,
      completedAt: data.completedAt,
      durationMs: data.durationMs,
      workerLeaseOwner: null,
      workerLeaseUntil: null,
      error: data.error ? structuredClone(data.error) : null,
      updatedAt: data.completedAt
    };
    this.runs.set(run.id, updatedRun);

    const nodeMap = this.nodeExecutionsByRun.get(run.id) ?? new Map();
    for (const nr of data.nodeResults) {
      const existing = nodeMap.get(nr.nodeId);
      nodeMap.set(nr.nodeId, {
        id: existing?.id ?? randomUUID(),
        runId: run.id,
        nodeId: nr.nodeId,
        nodeType: nr.nodeType,
        label: nr.label,
        status: nr.status,
        attemptCount: data.attemptNumber,
        startedAt: nr.startedAt,
        completedAt: nr.completedAt,
        durationMs: nr.durationMs,
        input: nr.input ? structuredClone(nr.input) : null,
        output: nr.output ? structuredClone(nr.output) : null,
        selectedBranch: nr.selectedBranch ?? null,
        skipReason: nr.skipReason ?? null,
        error: nr.error ? structuredClone(nr.error) : null,
        createdAt: existing?.createdAt ?? data.completedAt,
        updatedAt: data.completedAt
      });
    }
    this.nodeExecutionsByRun.set(run.id, nodeMap);

    const attempts = this.attemptsByRun.get(run.id) ?? [];
    const attemptEntry = attempts.find((a) => a.attemptNumber === data.attemptNumber);
    if (attemptEntry) {
      attemptEntry.status = data.status;
      attemptEntry.completedAt = data.completedAt;
      attemptEntry.error = data.error ?? null;
    }

    return structuredClone(updatedRun);
  }

  async claimPendingOutboxEvents(data: {
    dispatcherId: string;
    limit: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord[]> {
    const now = data.now ?? new Date();
    const leaseUntil = new Date(now.getTime() + data.leaseDurationMs);
    const claimed: OutboxEventRecord[] = [];

    const sorted = Array.from(this.outboxEvents.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    for (const ev of sorted) {
      if (claimed.length >= data.limit) break;

      const isEligiblePending =
        ev.status === "PENDING" && ev.nextAttemptAt.getTime() <= now.getTime();
      const isAbandonedProcessing =
        ev.status === "PROCESSING" &&
        ev.lockedUntil !== null &&
        ev.lockedUntil.getTime() <= now.getTime();

      if (!isEligiblePending && !isAbandonedProcessing) {
        continue;
      }

      if (ev.attempts >= ev.maxAttempts) {
        ev.status = "DEAD_LETTER";
        ev.lockedBy = null;
        ev.lockedUntil = null;
        ev.updatedAt = now;
        continue;
      }

      const updated: OutboxEventRecord = {
        ...ev,
        status: "PROCESSING",
        attempts: ev.attempts + 1,
        lockedBy: data.dispatcherId,
        lockedUntil: leaseUntil,
        updatedAt: now
      };
      this.outboxEvents.set(updated.id, updated);
      claimed.push(structuredClone(updated));
    }

    return claimed;
  }

  async markOutboxEventDelivered(data: {
    eventId: string;
    dispatcherId: string;
    now?: Date;
  }): Promise<boolean> {
    const now = data.now ?? new Date();
    const ev = this.outboxEvents.get(data.eventId);
    if (!ev) return false;
    if (ev.status === "DELIVERED") return true;
    if (ev.lockedBy !== data.dispatcherId) return false;

    this.outboxEvents.set(ev.id, {
      ...ev,
      status: "DELIVERED",
      deliveredAt: now,
      lockedBy: null,
      lockedUntil: null,
      updatedAt: now
    });
    return true;
  }

  async markOutboxEventFailed(data: {
    eventId: string;
    dispatcherId: string;
    errorMessage: string;
    retryDelayMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord | null> {
    const now = data.now ?? new Date();
    const ev = this.outboxEvents.get(data.eventId);
    if (!ev || ev.lockedBy !== data.dispatcherId) return null;

    const exhausted = ev.attempts >= ev.maxAttempts;
    const updated: OutboxEventRecord = {
      ...ev,
      status: exhausted ? "DEAD_LETTER" : "PENDING",
      nextAttemptAt: new Date(now.getTime() + Math.max(0, data.retryDelayMs)),
      lockedBy: null,
      lockedUntil: null,
      lastError: data.errorMessage.slice(0, 1000),
      updatedAt: now
    };
    this.outboxEvents.set(ev.id, updated);
    return structuredClone(updated);
  }

  async getOutboxMetrics(): Promise<{
    pendingCount: number;
    processingCount: number;
    deliveredCount: number;
    deadLetterCount: number;
  }> {
    let pendingCount = 0;
    let processingCount = 0;
    let deliveredCount = 0;
    let deadLetterCount = 0;

    for (const ev of this.outboxEvents.values()) {
      switch (ev.status) {
        case "PENDING":
          pendingCount++;
          break;
        case "PROCESSING":
          processingCount++;
          break;
        case "DELIVERED":
          deliveredCount++;
          break;
        case "DEAD_LETTER":
          deadLetterCount++;
          break;
      }
    }

    return {
      pendingCount,
      processingCount,
      deliveredCount,
      deadLetterCount
    };
  }
}
