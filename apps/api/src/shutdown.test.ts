import { describe, it, expect, vi } from "vitest";
import { createApiShutdownHandler } from "./shutdown.js";

describe("API Graceful Shutdown Handler", () => {
  it("drains connections, disconnects prisma, and exits with 0 on normal signal", async () => {
    let closed = false;
    let disconnected = false;
    let idleClosed = false;

    const mockServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        closed = true;
        cb?.();
      }),
      closeIdleConnections: vi.fn(() => {
        idleClosed = true;
      }),
      closeAllConnections: vi.fn()
    };

    const mockPrisma = {
      $disconnect: vi.fn(async () => {
        disconnected = true;
      })
    };

    const logs: Array<{ level: string; event: string }> = [];
    const exitFn = vi.fn();

    const shutdown = createApiShutdownHandler({
      server: mockServer,
      prismaClient: mockPrisma,
      deadlineMs: 5000,
      exitFn,
      logger: (level, event) => {
        logs.push({ level, event });
      }
    });

    await shutdown("SIGTERM");

    expect(idleClosed).toBe(true);
    expect(closed).toBe(true);
    expect(disconnected).toBe(true);
    expect(exitFn).toHaveBeenCalledWith(0);
    expect(logs.map((l) => l.event)).toContain("graceful_shutdown_started");
    expect(logs.map((l) => l.event)).toContain("graceful_shutdown_completed");
  });

  it("guards against duplicate/concurrent shutdown invocations", async () => {
    const mockServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        setTimeout(() => cb?.(), 50);
      })
    };

    const logs: Array<{ level: string; event: string }> = [];
    const exitFn = vi.fn();

    const shutdown = createApiShutdownHandler({
      server: mockServer,
      deadlineMs: 5000,
      exitFn,
      logger: (level, event) => {
        logs.push({ level, event });
      }
    });

    const p1 = shutdown("SIGTERM");
    const p2 = shutdown("SIGINT");

    await Promise.all([p1, p2]);

    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.event === "shutdown_already_in_progress")).toBe(true);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("handles errors during shutdown and exits with code 1", async () => {
    const mockServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.(new Error("Socket close failed"));
      })
    };

    const logs: Array<{ level: string; event: string }> = [];
    const exitFn = vi.fn();

    const shutdown = createApiShutdownHandler({
      server: mockServer,
      deadlineMs: 5000,
      exitFn,
      logger: (level, event) => {
        logs.push({ level, event });
      }
    });

    await shutdown("SIGTERM");

    expect(exitFn).toHaveBeenCalledWith(1);
    expect(logs.some((l) => l.event === "graceful_shutdown_error")).toBe(true);
  });

  it("triggers timeout deadline and forcibly closes connections if drain hangs", async () => {
    vi.useFakeTimers();
    try {
      const mockServer = {
        close: vi.fn((_cb?: (err?: Error) => void) => {
          // Never calls callback
        }),
        closeAllConnections: vi.fn()
      };

      const logs: Array<{ level: string; event: string }> = [];
      const exitFn = vi.fn();

      const shutdown = createApiShutdownHandler({
        server: mockServer,
        deadlineMs: 2000,
        exitFn,
        logger: (level, event) => {
          logs.push({ level, event });
        }
      });

      void shutdown("SIGTERM");

      // Advance timers past 2000ms deadline
      vi.advanceTimersByTime(2500);

      expect(mockServer.closeAllConnections).toHaveBeenCalled();
      expect(exitFn).toHaveBeenCalledWith(1);
      expect(logs.some((l) => l.event === "graceful_shutdown_deadline_exceeded")).toBe(true);

      // Finish pending promise if any
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
