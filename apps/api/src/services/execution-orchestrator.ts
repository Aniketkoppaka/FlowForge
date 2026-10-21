import type { ExecutionRepository, OutboxEventRecord } from "../repositories/types.js";
import {
  executeWorkflowGraph,
  createDefaultNodeHandlerRegistry,
  type HardenedHttpHandlerOptions,
  type NodeHandlerRegistry
} from "@flowforge/workflow-engine";

export interface QueueJobPayload {
  jobId: string;
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  userId: string;
}

export interface WorkflowJobQueuePublisher {
  enqueueRunJob(job: QueueJobPayload): Promise<void>;
}

/**
 * Calculates bounded exponential backoff with deterministic or random jitter.
 * Base delay: `baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`.
 */
export function computeOutboxBackoffMs(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60_000,
  jitterRatio: number = 0.15
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.round(exp * jitterRatio * 0.5);
  return Math.min(maxDelayMs, exp + jitter);
}

export interface OutboxDispatcherOptions {
  dispatcherId: string;
  batchSize?: number;
  leaseDurationMs?: number;
  baseRetryDelayMs?: number;
  now?: () => Date;
}

/**
 * Transactional Outbox Dispatcher.
 * Claims eligible PENDING (or expired-lease PROCESSING) outbox events, publishes them to the
 * job queue with deterministic `jobId: "run:<runId>"`, and marks them DELIVERED only after
 * queue publication succeeds. On publication error, records the failure with bounded backoff
 * and transitions poison events to DEAD_LETTER once `maxAttempts` is reached.
 */
export class OutboxDispatcher {
  private readonly executionRepo: ExecutionRepository;
  private readonly publisher: WorkflowJobQueuePublisher;
  private readonly dispatcherId: string;
  private readonly batchSize: number;
  private readonly leaseDurationMs: number;
  private readonly baseRetryDelayMs: number;
  private readonly now: () => Date;

  constructor(
    executionRepo: ExecutionRepository,
    publisher: WorkflowJobQueuePublisher,
    options: OutboxDispatcherOptions
  ) {
    this.executionRepo = executionRepo;
    this.publisher = publisher;
    this.dispatcherId = options.dispatcherId;
    this.batchSize = options.batchSize ?? 20;
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 1000;
    this.now = options.now ?? (() => new Date());
  }

  async dispatchBatch(): Promise<{
    claimed: number;
    delivered: number;
    failed: number;
    events: OutboxEventRecord[];
  }> {
    const currentNow = this.now();
    const events = await this.executionRepo.claimPendingOutboxEvents({
      dispatcherId: this.dispatcherId,
      limit: this.batchSize,
      leaseDurationMs: this.leaseDurationMs,
      now: currentNow
    });

    let delivered = 0;
    let failed = 0;

    for (const ev of events) {
      try {
        await this.publisher.enqueueRunJob({
          // Deterministic job ID prevents duplicate queue entries when an event is retried after a crash
          jobId: `run:${ev.payload.runId}`,
          runId: ev.payload.runId,
          workflowId: ev.payload.workflowId,
          workflowVersionId: ev.payload.workflowVersionId,
          userId: ev.payload.userId
        });

        const ok = await this.executionRepo.markOutboxEventDelivered({
          eventId: ev.id,
          dispatcherId: this.dispatcherId,
          now: this.now()
        });
        if (ok) {
          delivered++;
        }
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        const retryDelayMs = computeOutboxBackoffMs(
          ev.attempts,
          this.baseRetryDelayMs
        );
        await this.executionRepo.markOutboxEventFailed({
          eventId: ev.id,
          dispatcherId: this.dispatcherId,
          errorMessage: message,
          retryDelayMs,
          now: this.now()
        });
      }
    }

    return {
      claimed: events.length,
      delivered,
      failed,
      events
    };
  }
}

export interface RunWorkerProcessorOptions {
  workerId: string;
  leaseDurationMs?: number;
  enableOutboundHttp?: boolean;
  httpOptions?: HardenedHttpHandlerOptions;
  customHandlers?: NodeHandlerRegistry;
  now?: () => Date;
}

/**
 * Worker Execution Processor.
 * Claims a run via `claimRunForExecution` (acquiring an exclusive lease and attempt number),
 * executes the pinned immutable `WorkflowVersion.definition` outside any open database transaction,
 * and persists the terminal result via `completeRunExecution` (which fences out stale workers
 * and respects concurrent run cancellation).
 */
export class WorkflowRunProcessor {
  private readonly executionRepo: ExecutionRepository;
  private readonly options: RunWorkerProcessorOptions;

  constructor(
    executionRepo: ExecutionRepository,
    options: RunWorkerProcessorOptions
  ) {
    this.executionRepo = executionRepo;
    this.options = options;
  }

  async processRun(runId: string): Promise<{
    processed: boolean;
    status?: "COMPLETED" | "FAILED" | "CANCELLED" | "SKIPPED_CLAIM";
    attemptNumber?: number;
  }> {
    const clock = this.options.now ?? (() => new Date());
    const leaseDurationMs = this.options.leaseDurationMs ?? 60_000;

    const claimed = await this.executionRepo.claimRunForExecution({
      runId,
      workerId: this.options.workerId,
      leaseDurationMs,
      now: clock()
    });

    if (!claimed) {
      return { processed: false, status: "SKIPPED_CLAIM" };
    }

    const { run, version, attemptNumber } = claimed;

    const handlers =
      this.options.customHandlers ??
      createDefaultNodeHandlerRegistry({
        enableOutboundHttp: this.options.enableOutboundHttp ?? false,
        httpOptions: this.options.httpOptions
      });

    // Execute the pinned workflow version graph (no open DB transaction during execution!)
    const engineResult = await executeWorkflowGraph(
      version.definition,
      {
        executionId: run.id,
        workflowId: run.workflowId,
        triggerPayload: run.triggerPayload,
        now: clock
      },
      { handlers }
    );

    const completedRun = await this.executionRepo.completeRunExecution({
      runId: run.id,
      workerId: this.options.workerId,
      attemptNumber,
      status: engineResult.status,
      completedAt: new Date(engineResult.completedAt),
      durationMs: engineResult.durationMs,
      error: engineResult.error
        ? {
            code: engineResult.error.code,
            message: engineResult.error.message,
            nodeId: engineResult.error.nodeId,
            details: engineResult.error.details
          }
        : null,
      nodeResults: engineResult.nodeResults.map((nr) => ({
        nodeId: nr.nodeId,
        nodeType: nr.nodeType,
        label: nr.label,
        status: nr.status,
        startedAt: nr.startedAt ? new Date(nr.startedAt) : null,
        completedAt: nr.completedAt ? new Date(nr.completedAt) : null,
        durationMs: nr.durationMs,
        input: nr.input,
        output: nr.output,
        selectedBranch: nr.selectedBranch ?? null,
        skipReason: nr.skipReason ?? null,
        error: nr.error
          ? {
              code: nr.error.code,
              message: nr.error.message,
              nodeId: nr.error.nodeId,
              details: nr.error.details
            }
          : null
      }))
    });

    if (!completedRun) {
      // Stale worker fenced out or run was cancelled while executing
      return { processed: false, status: "CANCELLED", attemptNumber };
    }

    return {
      processed: true,
      status: completedRun.status as "COMPLETED" | "FAILED",
      attemptNumber
    };
  }
}
