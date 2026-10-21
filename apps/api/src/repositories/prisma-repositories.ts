import { prisma, Prisma } from "@flowforge/database";
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
  OutboxEventRecord,
  PublishVersionResult,
  CreateRunWithOutboxResult
} from "./types.js";

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
  }

  async findById(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({
      where: { id }
    });
  }

  async create(data: {
    email: string;
    name?: string | null;
    passwordHash: string;
  }): Promise<UserRecord> {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name ?? null,
        passwordHash: data.passwordHash
      }
    });
  }
}

export class PrismaSessionRepository implements SessionRepository {
  async create(data: {
    jti: string;
    userId: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    return prisma.session.create({
      data: {
        jti: data.jti,
        userId: data.userId,
        expiresAt: data.expiresAt
      }
    });
  }

  async findActiveByJti(jti: string, now: Date = new Date()): Promise<SessionRecord | null> {
    return prisma.session.findFirst({
      where: {
        jti,
        revokedAt: null,
        expiresAt: {
          gt: now
        }
      }
    });
  }

  async revokeByJti(jti: string): Promise<boolean> {
    const result = await prisma.session.updateMany({
      where: {
        jti,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    return result.count > 0;
  }
}

export class PrismaWorkflowRepository implements WorkflowRepository {
  async create(data: {
    userId: string;
    name: string;
    description?: string | null;
    draftDefinition?: unknown;
  }): Promise<WorkflowRecord> {
    const defaultDraft = { schemaVersion: 1, nodes: [], edges: [] };
    return prisma.workflow.create({
      data: {
        userId: data.userId,
        name: data.name,
        description: data.description ?? null,
        draftDefinition: (data.draftDefinition ?? defaultDraft) as Prisma.InputJsonValue
      }
    });
  }

  async findActiveByUserId(userId: string): Promise<WorkflowRecord[]> {
    return prisma.workflow.findMany({
      where: {
        userId,
        deletedAt: null
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  async findActiveByIdAndUserId(id: string, userId: string): Promise<WorkflowRecord | null> {
    return prisma.workflow.findFirst({
      where: {
        id,
        userId,
        deletedAt: null
      }
    });
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
    const existing = await this.findActiveByIdAndUserId(id, userId);
    if (!existing) {
      return null;
    }

    const updateData: Prisma.WorkflowUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.draftDefinition !== undefined) {
      updateData.draftDefinition = data.draftDefinition as Prisma.InputJsonValue;
    }

    return prisma.workflow.update({
      where: { id: existing.id },
      data: updateData
    });
  }

  async softDeleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const result = await prisma.workflow.updateMany({
      where: {
        id,
        userId,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    return result.count > 0;
  }

  async publishVersion(data: {
    workflowId: string;
    userId: string;
    contentHash: string;
    definition: unknown;
  }): Promise<PublishVersionResult | null> {
    return prisma.$transaction(async (tx) => {
      const wf = await tx.workflow.findFirst({
        where: {
          id: data.workflowId,
          userId: data.userId,
          deletedAt: null
        }
      });
      if (!wf) {
        return null;
      }

      if (wf.publishedVersionId) {
        const currentPub = await tx.workflowVersion.findUnique({
          where: { id: wf.publishedVersionId }
        });
        if (currentPub && currentPub.contentHash === data.contentHash) {
          return {
            workflow: wf,
            version: currentPub,
            alreadyPublished: true
          };
        }
      }

      const latest = await tx.workflowVersion.findFirst({
        where: { workflowId: data.workflowId },
        orderBy: { versionNumber: "desc" }
      });

      const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
      const version = await tx.workflowVersion.create({
        data: {
          workflowId: data.workflowId,
          versionNumber: nextVersionNumber,
          contentHash: data.contentHash,
          definition: data.definition as Prisma.InputJsonValue
        }
      });

      const updatedWorkflow = await tx.workflow.update({
        where: { id: data.workflowId },
        data: {
          publishedVersionId: version.id,
          publishedVersionNumber: nextVersionNumber
        }
      });

      return {
        workflow: updatedWorkflow,
        version,
        alreadyPublished: false
      };
    });
  }

  async listVersionsByWorkflowIdAndUserId(
    workflowId: string,
    userId: string
  ): Promise<WorkflowVersionRecord[]> {
    const wf = await this.findActiveByIdAndUserId(workflowId, userId);
    if (!wf) return [];

    return prisma.workflowVersion.findMany({
      where: { workflowId },
      orderBy: { versionNumber: "desc" }
    });
  }

  async findVersionById(
    workflowId: string,
    versionId: string
  ): Promise<WorkflowVersionRecord | null> {
    return prisma.workflowVersion.findFirst({
      where: {
        id: versionId,
        workflowId
      }
    });
  }
}

function mapPrismaRunRecord(raw: {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  versionNumber: number;
  userId: string;
  status: string;
  triggerPayload: Prisma.JsonValue;
  idempotencyKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  workerLeaseOwner: string | null;
  workerLeaseUntil: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  durationMs: number | null;
  error: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): WorkflowRunRecord {
  return {
    id: raw.id,
    workflowId: raw.workflowId,
    workflowVersionId: raw.workflowVersionId,
    versionNumber: raw.versionNumber,
    userId: raw.userId,
    status: raw.status as WorkflowRunRecord["status"],
    triggerPayload: (raw.triggerPayload as Record<string, unknown>) ?? {},
    idempotencyKey: raw.idempotencyKey,
    attemptCount: raw.attemptCount,
    maxAttempts: raw.maxAttempts,
    workerLeaseOwner: raw.workerLeaseOwner,
    workerLeaseUntil: raw.workerLeaseUntil,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    cancelledAt: raw.cancelledAt,
    durationMs: raw.durationMs,
    error: (raw.error as WorkflowRunRecord["error"]) ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

function mapPrismaNodeExecution(raw: {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  label: string;
  status: string;
  attemptCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  input: Prisma.JsonValue | null;
  output: Prisma.JsonValue | null;
  selectedBranch: string | null;
  skipReason: string | null;
  error: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): NodeExecutionRecordEntity {
  return {
    id: raw.id,
    runId: raw.runId,
    nodeId: raw.nodeId,
    nodeType: raw.nodeType as NodeExecutionRecordEntity["nodeType"],
    label: raw.label,
    status: raw.status as NodeExecutionRecordEntity["status"],
    attemptCount: raw.attemptCount,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    durationMs: raw.durationMs,
    input: (raw.input as Record<string, unknown>) ?? null,
    output: (raw.output as Record<string, unknown>) ?? null,
    selectedBranch: (raw.selectedBranch as "true" | "false" | null) ?? null,
    skipReason: raw.skipReason,
    error: (raw.error as NodeExecutionRecordEntity["error"]) ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

function mapPrismaOutboxEvent(raw: {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  deliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OutboxEventRecord {
  return {
    id: raw.id,
    eventType: raw.eventType as "WORKFLOW_RUN_CREATED",
    aggregateId: raw.aggregateId,
    payload: raw.payload as OutboxEventRecord["payload"],
    status: raw.status as OutboxEventRecord["status"],
    attempts: raw.attempts,
    maxAttempts: raw.maxAttempts,
    nextAttemptAt: raw.nextAttemptAt,
    lockedBy: raw.lockedBy,
    lockedUntil: raw.lockedUntil,
    deliveredAt: raw.deliveredAt,
    lastError: raw.lastError,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

export class PrismaExecutionRepository implements ExecutionRepository {
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

    return prisma.$transaction(async (tx) => {
      if (idemKey) {
        const existing = await tx.workflowRun.findUnique({
          where: {
            userId_workflowId_idempotencyKey: {
              userId: data.userId,
              workflowId: data.workflowId,
              idempotencyKey: idemKey
            }
          }
        });
        if (existing) {
          const sameVersion = existing.workflowVersionId === data.workflowVersionId;
          const samePayload =
            JSON.stringify(existing.triggerPayload) ===
            JSON.stringify(data.triggerPayload);
          if (!sameVersion || !samePayload) {
            return {
              run: mapPrismaRunRecord(existing),
              outboxEvent: null,
              reusedIdempotentRun: false,
              idempotencyConflict: true
            };
          }
          return {
            run: mapPrismaRunRecord(existing),
            outboxEvent: null,
            reusedIdempotentRun: true
          };
        }
      }

      const createdRun = await tx.workflowRun.create({
        data: {
          workflowId: data.workflowId,
          workflowVersionId: data.workflowVersionId,
          versionNumber: data.versionNumber,
          userId: data.userId,
          status: "QUEUED",
          triggerPayload: data.triggerPayload as Prisma.InputJsonValue,
          idempotencyKey: idemKey,
          attemptCount: 0,
          maxAttempts: data.maxAttempts ?? 3
        }
      });

      if (data.initialNodes.length > 0) {
        await tx.nodeExecution.createMany({
          data: data.initialNodes.map((n) => ({
            runId: createdRun.id,
            nodeId: n.nodeId,
            nodeType: n.nodeType,
            label: n.label,
            status: "PENDING",
            attemptCount: 0
          }))
        });
      }

      const outbox = await tx.outboxEvent.create({
        data: {
          eventType: "WORKFLOW_RUN_CREATED",
          aggregateId: createdRun.id,
          payload: {
            runId: createdRun.id,
            workflowId: data.workflowId,
            workflowVersionId: data.workflowVersionId,
            userId: data.userId
          } as Prisma.InputJsonValue,
          status: "PENDING",
          attempts: 0,
          maxAttempts: 5
        }
      });

      return {
        run: mapPrismaRunRecord(createdRun),
        outboxEvent: mapPrismaOutboxEvent(outbox),
        reusedIdempotentRun: false
      };
    });
  }

  async findRunByIdAndUserId(
    runId: string,
    userId: string
  ): Promise<{
    run: WorkflowRunRecord;
    nodeExecutions: NodeExecutionRecordEntity[];
  } | null> {
    const found = await prisma.workflowRun.findFirst({
      where: {
        id: runId,
        userId
      },
      include: {
        nodeExecutions: {
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!found) return null;

    return {
      run: mapPrismaRunRecord(found),
      nodeExecutions: found.nodeExecutions.map(mapPrismaNodeExecution)
    };
  }

  async listRunsByWorkflowIdAndUserId(
    workflowId: string,
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ runs: WorkflowRunRecord[]; total: number }> {
    const take = Math.min(Math.max(1, options?.limit ?? 20), 100);
    const skip = Math.max(0, options?.offset ?? 0);

    const [rows, total] = await Promise.all([
      prisma.workflowRun.findMany({
        where: { workflowId, userId },
        orderBy: { createdAt: "desc" },
        take,
        skip
      }),
      prisma.workflowRun.count({
        where: { workflowId, userId }
      })
    ]);

    return {
      runs: rows.map(mapPrismaRunRecord),
      total
    };
  }

  async cancelRunByIdAndUserId(
    runId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<WorkflowRunRecord | null> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.workflowRun.findFirst({
        where: { id: runId, userId }
      });
      if (!existing) return null;

      if (
        existing.status === "COMPLETED" ||
        existing.status === "FAILED" ||
        existing.status === "CANCELLED"
      ) {
        return mapPrismaRunRecord(existing);
      }

      const updated = await tx.workflowRun.update({
        where: { id: runId },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          completedAt: now,
          workerLeaseOwner: null,
          workerLeaseUntil: null
        }
      });

      await tx.nodeExecution.updateMany({
        where: {
          runId,
          status: { in: ["PENDING", "RUNNING"] }
        },
        data: {
          status: "CANCELLED",
          completedAt: now
        }
      });

      return mapPrismaRunRecord(updated);
    });
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
    const leaseUntil = new Date(now.getTime() + data.leaseDurationMs);

    return prisma.$transaction(async (tx) => {
      const existing = await tx.workflowRun.findUnique({
        where: { id: data.runId },
        include: { workflowVersion: true }
      });
      if (!existing) return null;

      if (
        existing.status === "COMPLETED" ||
        existing.status === "FAILED" ||
        existing.status === "CANCELLED"
      ) {
        return null;
      }

      if (
        existing.status === "RUNNING" &&
        existing.workerLeaseUntil &&
        existing.workerLeaseUntil.getTime() > now.getTime() &&
        existing.workerLeaseOwner !== data.workerId
      ) {
        return null;
      }

      if (existing.attemptCount >= existing.maxAttempts) {
        await tx.workflowRun.update({
          where: { id: existing.id },
          data: {
            status: "FAILED",
            completedAt: now,
            workerLeaseOwner: null,
            workerLeaseUntil: null,
            error: {
              code: "MAX_ATTEMPTS_EXHAUSTED",
              message: `Run exceeded maximum execution attempts (${existing.maxAttempts}).`
            } as Prisma.InputJsonValue
          }
        });
        return null;
      }

      const nextAttempt = existing.attemptCount + 1;

      // Conditional update using attemptCount optimistic concurrency check
      const claimUpdate = await tx.workflowRun.updateMany({
        where: {
          id: existing.id,
          attemptCount: existing.attemptCount,
          status: { in: ["QUEUED", "RUNNING"] }
        },
        data: {
          status: "RUNNING",
          attemptCount: nextAttempt,
          workerLeaseOwner: data.workerId,
          workerLeaseUntil: leaseUntil,
          startedAt: existing.startedAt ?? now
        }
      });

      if (claimUpdate.count === 0) {
        return null;
      }

      await tx.executionAttempt.create({
        data: {
          runId: existing.id,
          attemptNumber: nextAttempt,
          workerId: data.workerId,
          status: "RUNNING",
          startedAt: now
        }
      });

      const refreshed = await tx.workflowRun.findUniqueOrThrow({
        where: { id: existing.id }
      });

      return {
        run: mapPrismaRunRecord(refreshed),
        version: existing.workflowVersion,
        attemptNumber: nextAttempt
      };
    });
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
    return prisma.$transaction(async (tx) => {
      // Conditional fenced update: only succeeds if status === 'RUNNING', workerLeaseOwner === workerId, and attemptCount === attemptNumber
      const guardedUpdate = await tx.workflowRun.updateMany({
        where: {
          id: data.runId,
          status: "RUNNING",
          workerLeaseOwner: data.workerId,
          attemptCount: data.attemptNumber
        },
        data: {
          status: data.status,
          completedAt: data.completedAt,
          durationMs: data.durationMs,
          workerLeaseOwner: null,
          workerLeaseUntil: null,
          error: data.error
            ? (data.error as Prisma.InputJsonValue)
            : Prisma.DbNull
        }
      });

      if (guardedUpdate.count === 0) {
        return null;
      }

      for (const nr of data.nodeResults) {
        await tx.nodeExecution.upsert({
          where: {
            runId_nodeId: {
              runId: data.runId,
              nodeId: nr.nodeId
            }
          },
          create: {
            runId: data.runId,
            nodeId: nr.nodeId,
            nodeType: nr.nodeType,
            label: nr.label,
            status: nr.status,
            attemptCount: data.attemptNumber,
            startedAt: nr.startedAt,
            completedAt: nr.completedAt,
            durationMs: nr.durationMs,
            input: nr.input ? (nr.input as Prisma.InputJsonValue) : Prisma.DbNull,
            output: nr.output ? (nr.output as Prisma.InputJsonValue) : Prisma.DbNull,
            selectedBranch: nr.selectedBranch ?? null,
            skipReason: nr.skipReason ?? null,
            error: nr.error ? (nr.error as Prisma.InputJsonValue) : Prisma.DbNull
          },
          update: {
            status: nr.status,
            attemptCount: data.attemptNumber,
            startedAt: nr.startedAt,
            completedAt: nr.completedAt,
            durationMs: nr.durationMs,
            input: nr.input ? (nr.input as Prisma.InputJsonValue) : Prisma.DbNull,
            output: nr.output ? (nr.output as Prisma.InputJsonValue) : Prisma.DbNull,
            selectedBranch: nr.selectedBranch ?? null,
            skipReason: nr.skipReason ?? null,
            error: nr.error ? (nr.error as Prisma.InputJsonValue) : Prisma.DbNull
          }
        });
      }

      await tx.executionAttempt.updateMany({
        where: {
          runId: data.runId,
          attemptNumber: data.attemptNumber
        },
        data: {
          status: data.status,
          completedAt: data.completedAt,
          error: data.error ? (data.error as Prisma.InputJsonValue) : Prisma.DbNull
        }
      });

      const finalRun = await tx.workflowRun.findUniqueOrThrow({
        where: { id: data.runId }
      });

      return mapPrismaRunRecord(finalRun);
    });
  }

  async claimPendingOutboxEvents(data: {
    dispatcherId: string;
    limit: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord[]> {
    const now = data.now ?? new Date();
    const leaseUntil = new Date(now.getTime() + data.leaseDurationMs);

    const candidates = await prisma.outboxEvent.findMany({
      where: {
        OR: [
          {
            status: "PENDING",
            nextAttemptAt: { lte: now }
          },
          {
            status: "PROCESSING",
            lockedUntil: { lte: now }
          }
        ]
      },
      orderBy: { createdAt: "asc" },
      take: data.limit * 2
    });

    const claimed: OutboxEventRecord[] = [];
    for (const ev of candidates) {
      if (claimed.length >= data.limit) break;

      if (ev.attempts >= ev.maxAttempts) {
        await prisma.outboxEvent.updateMany({
          where: { id: ev.id, attempts: ev.attempts },
          data: {
            status: "DEAD_LETTER",
            lockedBy: null,
            lockedUntil: null
          }
        });
        continue;
      }

      const res = await prisma.outboxEvent.updateMany({
        where: {
          id: ev.id,
          attempts: ev.attempts,
          status: ev.status
        },
        data: {
          status: "PROCESSING",
          attempts: ev.attempts + 1,
          lockedBy: data.dispatcherId,
          lockedUntil: leaseUntil
        }
      });

      if (res.count === 1) {
        const refreshed = await prisma.outboxEvent.findUnique({
          where: { id: ev.id }
        });
        if (refreshed) {
          claimed.push(mapPrismaOutboxEvent(refreshed));
        }
      }
    }

    return claimed;
  }

  async markOutboxEventDelivered(data: {
    eventId: string;
    dispatcherId: string;
    now?: Date;
  }): Promise<boolean> {
    const now = data.now ?? new Date();
    const res = await prisma.outboxEvent.updateMany({
      where: {
        id: data.eventId,
        lockedBy: data.dispatcherId
      },
      data: {
        status: "DELIVERED",
        deliveredAt: now,
        lockedBy: null,
        lockedUntil: null
      }
    });
    return res.count > 0;
  }

  async markOutboxEventFailed(data: {
    eventId: string;
    dispatcherId: string;
    errorMessage: string;
    retryDelayMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord | null> {
    const now = data.now ?? new Date();
    const existing = await prisma.outboxEvent.findFirst({
      where: {
        id: data.eventId,
        lockedBy: data.dispatcherId
      }
    });
    if (!existing) return null;

    const exhausted = existing.attempts >= existing.maxAttempts;
    const updated = await prisma.outboxEvent.update({
      where: { id: existing.id },
      data: {
        status: exhausted ? "DEAD_LETTER" : "PENDING",
        nextAttemptAt: new Date(now.getTime() + Math.max(0, data.retryDelayMs)),
        lockedBy: null,
        lockedUntil: null,
        lastError: data.errorMessage.slice(0, 1000)
      }
    });

    return mapPrismaOutboxEvent(updated);
  }

  async getOutboxMetrics(): Promise<{
    pendingCount: number;
    processingCount: number;
    deliveredCount: number;
    deadLetterCount: number;
  }> {
    const [pendingCount, processingCount, deliveredCount, deadLetterCount] =
      await Promise.all([
        prisma.outboxEvent.count({ where: { status: "PENDING" } }),
        prisma.outboxEvent.count({ where: { status: "PROCESSING" } }),
        prisma.outboxEvent.count({ where: { status: "DELIVERED" } }),
        prisma.outboxEvent.count({ where: { status: "DEAD_LETTER" } })
      ]);

    return {
      pendingCount,
      processingCount,
      deliveredCount,
      deadLetterCount
    };
  }
}
