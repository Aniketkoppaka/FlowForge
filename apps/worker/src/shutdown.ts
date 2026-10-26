export interface StoppableWorker {
  stop: () => Promise<void>;
  getStatus?: () => Record<string, unknown>;
}

export interface DisconnectablePrisma {
  $disconnect: () => Promise<void>;
}

export interface WorkerShutdownOptions {
  worker: StoppableWorker;
  prismaClient?: DisconnectablePrisma;
  deadlineMs?: number;
  exitFn?: (code: number) => void;
  logger?: (
    level: "info" | "warn" | "error",
    event: string,
    data?: Record<string, unknown>
  ) => void;
}

export function createWorkerShutdownHandler({
  worker,
  prismaClient,
  deadlineMs = 15_000,
  exitFn = (code) => process.exit(code),
  logger = (level, event, data) => {
    console.log(
      JSON.stringify({
        level,
        service: "@flowforge/worker",
        event,
        ...data,
        timestamp: new Date().toISOString()
      })
    );
  }
}: WorkerShutdownOptions): (signal: string) => Promise<void> {
  let isShuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      logger("warn", "worker_shutdown_already_in_progress", { signal });
      return;
    }
    isShuttingDown = true;

    logger("info", "shutdown_signal_received", { signal });

    const timeoutTimer = setTimeout(() => {
      logger("error", "worker_shutdown_deadline_exceeded", {
        signal,
        deadlineMs
      });
      exitFn(1);
    }, deadlineMs);

    if (typeof timeoutTimer.unref === "function") {
      timeoutTimer.unref();
    }

    try {
      await worker.stop();

      if (prismaClient) {
        await prismaClient.$disconnect();
      }

      clearTimeout(timeoutTimer);
      logger("info", "worker_shutdown_completed", { signal });
      exitFn(0);
    } catch (err) {
      clearTimeout(timeoutTimer);
      logger("error", "worker_shutdown_error", {
        signal,
        error: err instanceof Error ? err.message : String(err)
      });
      exitFn(1);
    }
  };
}
