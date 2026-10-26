import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@flowforge/database";
import {
  ENGINE_VERSION,
  executeWorkflowGraph,
  createDefaultNodeHandlerRegistry,
  type HardenedHttpHandlerOptions
} from "@flowforge/workflow-engine";
import { createWorkerShutdownHandler } from "./shutdown.js";

export const WORKER_QUEUE_NAME = "flowforge-workflow-runs" as const;

export interface WorkerRuntimeConfig {
  workerId: string;
  pollIntervalMs: number;
  leaseDurationMs: number;
  concurrency: number;
  enableOutboundHttp: boolean;
  httpOptions?: HardenedHttpHandlerOptions;
  heartbeatPath?: string;
}

export function getWorkerInfo() {
  return {
    service: "@flowforge/worker",
    engineVersion: ENGINE_VERSION,
    queueName: WORKER_QUEUE_NAME,
    status: "standby"
  } as const;
}

/**
 * Computes exponential backoff with bounded jitter for outbox/worker retries.
 */
export function computeWorkerBackoffMs(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60_000
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.round(exp * 0.1);
  return Math.min(maxDelayMs, exp + jitter);
}

/**
 * Persistent background worker service.
 * Polls and claims pending `OutboxEvent` records (`WORKFLOW_RUN_CREATED`) with atomic database
 * leases, claims the corresponding `WorkflowRun` with optimistic attempt fencing, executes the
 * pinned `WorkflowVersion` via `@flowforge/workflow-engine` (outside any open DB transaction),
 * and commits node and run statuses atomically.
 */
export class FlowForgeWorkerRuntime {
  private readonly config: WorkerRuntimeConfig;
  private running = false;
  private activeJobs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<WorkerRuntimeConfig>) {
    this.config = {
      workerId: config?.workerId ?? `worker_${randomUUID().slice(0, 8)}`,
      pollIntervalMs: config?.pollIntervalMs ?? 1500,
      leaseDurationMs: config?.leaseDurationMs ?? 60_000,
      concurrency: Math.min(Math.max(1, config?.concurrency ?? 4), 20),
      enableOutboundHttp:
        config?.enableOutboundHttp ??
        process.env.ENABLE_OUTBOUND_HTTP === "true",
      httpOptions: config?.httpOptions,
      heartbeatPath: config?.heartbeatPath ?? process.env.WORKER_HEARTBEAT_PATH
    };
  }

  private recordHeartbeat(): void {
    if (this.config.heartbeatPath) {
      try {
        fs.writeFileSync(this.config.heartbeatPath, String(Date.now()), "utf8");
      } catch {
        // Non-fatal if filesystem is temporarily unavailable or read-only
      }
    }
  }

  getStatus() {
    return {
      service: "@flowforge/worker",
      workerId: this.config.workerId,
      engineVersion: ENGINE_VERSION,
      running: this.running,
      activeJobs: this.activeJobs,
      concurrency: this.config.concurrency,
      enableOutboundHttp: this.config.enableOutboundHttp
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.recordHeartbeat();
    this.log("info", "worker_started", this.getStatus());
    this.scheduleNextTick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Wait up to 10s for in-flight jobs to finish
    const deadline = Date.now() + 10_000;
    while (this.activeJobs > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.log("info", "worker_stopped", { activeJobsRemaining: this.activeJobs });
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.pollAndProcessBatch();
      } catch (err) {
        this.log("error", "worker_poll_error", {
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        this.scheduleNextTick();
      }
    }, this.config.pollIntervalMs);
  }

  async pollAndProcessBatch(): Promise<number> {
    const availableSlots = this.config.concurrency - this.activeJobs;
    if (availableSlots <= 0) return 0;

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.config.leaseDurationMs);

    const candidates = await prisma.outboxEvent.findMany({
      where: {
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "PROCESSING", lockedUntil: { lte: now } }
        ]
      },
      orderBy: { createdAt: "asc" },
      take: availableSlots
    });

    this.recordHeartbeat();

    let processedCount = 0;

    for (const candidate of candidates) {
      if (candidate.attempts >= candidate.maxAttempts) {
        await prisma.outboxEvent.updateMany({
          where: { id: candidate.id, attempts: candidate.attempts },
          data: { status: "DEAD_LETTER", lockedBy: null, lockedUntil: null }
        });
        continue;
      }

      const claimedOutbox = await prisma.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          attempts: candidate.attempts,
          status: candidate.status
        },
        data: {
          status: "PROCESSING",
          attempts: candidate.attempts + 1,
          lockedBy: this.config.workerId,
          lockedUntil: leaseUntil
        }
      });

      if (claimedOutbox.count !== 1) continue;

      this.activeJobs++;
      try {
        const payload = candidate.payload as { runId?: string };
        if (payload?.runId) {
          await this.executeRunById(payload.runId);
        }

        await prisma.outboxEvent.updateMany({
          where: { id: candidate.id, lockedBy: this.config.workerId },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date(),
            lockedBy: null,
            lockedUntil: null
          }
        });
        processedCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const nextAttempt = candidate.attempts + 1;
        const exhausted = nextAttempt >= candidate.maxAttempts;
        const delay = computeWorkerBackoffMs(nextAttempt);

        await prisma.outboxEvent.updateMany({
          where: { id: candidate.id, lockedBy: this.config.workerId },
          data: {
            status: exhausted ? "DEAD_LETTER" : "PENDING",
            nextAttemptAt: new Date(Date.now() + delay),
            lockedBy: null,
            lockedUntil: null,
            lastError: errMsg.slice(0, 1000)
          }
        });
      } finally {
        this.activeJobs--;
      }
    }

    return processedCount;
  }

  async executeRunById(runId: string): Promise<void> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.config.leaseDurationMs);

    const claimed = await prisma.$transaction(async (tx) => {
      const existing = await tx.workflowRun.findUnique({
        where: { id: runId },
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
        existing.workerLeaseOwner !== this.config.workerId
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
      const updateRes = await tx.workflowRun.updateMany({
        where: {
          id: existing.id,
          attemptCount: existing.attemptCount,
          status: { in: ["QUEUED", "RUNNING"] }
        },
        data: {
          status: "RUNNING",
          attemptCount: nextAttempt,
          workerLeaseOwner: this.config.workerId,
          workerLeaseUntil: leaseUntil,
          startedAt: existing.startedAt ?? now
        }
      });

      if (updateRes.count === 0) return null;

      await tx.executionAttempt.create({
        data: {
          runId: existing.id,
          attemptNumber: nextAttempt,
          workerId: this.config.workerId,
          status: "RUNNING",
          startedAt: now
        }
      });

      return {
        runId: existing.id,
        workflowId: existing.workflowId,
        triggerPayload:
          (existing.triggerPayload as Record<string, unknown>) ?? {},
        definition: existing.workflowVersion.definition,
        attemptNumber: nextAttempt
      };
    });

    if (!claimed) return;

    const handlers = createDefaultNodeHandlerRegistry({
      enableOutboundHttp: this.config.enableOutboundHttp,
      httpOptions: this.config.httpOptions
    });

    // Execute workflow outside DB transaction
    const result = await executeWorkflowGraph(
      claimed.definition,
      {
        executionId: claimed.runId,
        workflowId: claimed.workflowId,
        triggerPayload: claimed.triggerPayload
      },
      { handlers }
    );

    const completedAt = new Date(result.completedAt);

    await prisma.$transaction(async (tx) => {
      const guarded = await tx.workflowRun.updateMany({
        where: {
          id: claimed.runId,
          status: "RUNNING",
          workerLeaseOwner: this.config.workerId,
          attemptCount: claimed.attemptNumber
        },
        data: {
          status: result.status,
          completedAt,
          durationMs: result.durationMs,
          workerLeaseOwner: null,
          workerLeaseUntil: null,
          error: result.error
            ? (result.error as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull
        }
      });

      if (guarded.count === 0) return;

      for (const nr of result.nodeResults) {
        await tx.nodeExecution.upsert({
          where: {
            runId_nodeId: {
              runId: claimed.runId,
              nodeId: nr.nodeId
            }
          },
          create: {
            runId: claimed.runId,
            nodeId: nr.nodeId,
            nodeType: nr.nodeType,
            label: nr.label,
            status: nr.status,
            attemptCount: claimed.attemptNumber,
            startedAt: nr.startedAt ? new Date(nr.startedAt) : null,
            completedAt: nr.completedAt ? new Date(nr.completedAt) : null,
            durationMs: nr.durationMs,
            input: nr.input ? (nr.input as Prisma.InputJsonValue) : Prisma.DbNull,
            output: nr.output ? (nr.output as Prisma.InputJsonValue) : Prisma.DbNull,
            selectedBranch: nr.selectedBranch ?? null,
            skipReason: nr.skipReason ?? null,
            error: nr.error
              ? (nr.error as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull
          },
          update: {
            status: nr.status,
            attemptCount: claimed.attemptNumber,
            startedAt: nr.startedAt ? new Date(nr.startedAt) : null,
            completedAt: nr.completedAt ? new Date(nr.completedAt) : null,
            durationMs: nr.durationMs,
            input: nr.input ? (nr.input as Prisma.InputJsonValue) : Prisma.DbNull,
            output: nr.output ? (nr.output as Prisma.InputJsonValue) : Prisma.DbNull,
            selectedBranch: nr.selectedBranch ?? null,
            skipReason: nr.skipReason ?? null,
            error: nr.error
              ? (nr.error as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull
          }
        });
      }

      await tx.executionAttempt.updateMany({
        where: {
          runId: claimed.runId,
          attemptNumber: claimed.attemptNumber
        },
        data: {
          status: result.status,
          completedAt,
          error: result.error
            ? (result.error as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull
        }
      });
    });
  }

  private log(level: "info" | "warn" | "error", event: string, data: Record<string, unknown>) {
    if (process.env.NODE_ENV === "test") return;
    console.log(
      JSON.stringify({
        level,
        service: "@flowforge/worker",
        workerId: this.config.workerId,
        event,
        ...data,
        timestamp: new Date().toISOString()
      })
    );
  }
}

if (process.env.NODE_ENV !== "test") {
  const worker = new FlowForgeWorkerRuntime();
  worker.start();

  const shutdown = createWorkerShutdownHandler({
    worker,
    prismaClient: prisma,
    deadlineMs: 15_000
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

export { createWorkerShutdownHandler };
