export interface CloseableServer {
  close: (cb?: (err?: Error) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface DisconnectablePrisma {
  $disconnect: () => Promise<void>;
}

export interface ApiShutdownOptions {
  server: CloseableServer;
  prismaClient?: DisconnectablePrisma;
  deadlineMs?: number;
  exitFn?: (code: number) => void;
  logger?: (
    level: "info" | "warn" | "error",
    event: string,
    data?: Record<string, unknown>
  ) => void;
}

export function createApiShutdownHandler({
  server,
  prismaClient,
  deadlineMs = 10_000,
  exitFn = (code) => process.exit(code),
  logger = (level, event, data) => {
    console.log(
      JSON.stringify({
        level,
        service: "@flowforge/api",
        event,
        ...data,
        timestamp: new Date().toISOString()
      })
    );
  }
}: ApiShutdownOptions): (signal: string) => Promise<void> {
  let isShuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      logger("warn", "shutdown_already_in_progress", { signal });
      return;
    }
    isShuttingDown = true;

    logger("info", "graceful_shutdown_started", { signal });

    const timeoutTimer = setTimeout(() => {
      logger("error", "graceful_shutdown_deadline_exceeded", {
        signal,
        deadlineMs
      });
      if (typeof server.closeAllConnections === "function") {
        try {
          server.closeAllConnections();
        } catch {
          // ignore error on force close
        }
      }
      exitFn(1);
    }, deadlineMs);

    // Unref timeout timer so it doesn't keep node event loop alive unnecessarily
    if (typeof timeoutTimer.unref === "function") {
      timeoutTimer.unref();
    }

    try {
      // Close idle keep-alive connections first
      if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }

      // Stop accepting new connections and drain active requests
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // Disconnect Prisma client if provided
      if (prismaClient) {
        await prismaClient.$disconnect();
      }

      clearTimeout(timeoutTimer);

      logger("info", "graceful_shutdown_completed", { signal });
      exitFn(0);
    } catch (err) {
      clearTimeout(timeoutTimer);
      logger("error", "graceful_shutdown_error", {
        signal,
        error: err instanceof Error ? err.message : String(err)
      });
      exitFn(1);
    }
  };
}
