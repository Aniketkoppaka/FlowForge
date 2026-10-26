import { describe, it, expect, vi } from "vitest";
import { createWorkerShutdownHandler } from "./shutdown.js";

describe("Worker Graceful Shutdown Handler", () => {
  it("stops worker runtime, disconnects prisma, and exits with 0 on normal signal", async () => {
    let stopped = false;
    let disconnected = false;

    const mockWorker = {
      stop: vi.fn(async () => {
        stopped = true;
      }),
      getStatus: vi.fn(() => ({ activeJobs: 0 }))
    };

    const mockPrisma = {
      $disconnect: vi.fn(async () => {
        disconnected = true;
      })
    };

    const logs: Array<{ level: string; event: string }> = [];
    const exitFn = vi.fn();

    const shutdown = createWorkerShutdownHandler({
      worker: mockWorker,
      prismaClient: mockPrisma,
      deadlineMs: 5000,
      exitFn,
      logger: (level, event) => {
        logs.push({ level, event });
      }
    });

    await shutdown("SIGTERM");

    expect(stopped).toBe(true);
    expect(disconnected).toBe(true);
    expect(exitFn).toHaveBeenCalledWith(0);
    expect(logs.map((l) => l.event)).toContain("shutdown_signal_received");
    expect(logs.map((l) => l.event)).toContain("worker_shutdown_completed");
  });

  it("guards against concurrent/duplicate worker shutdown signals", async () => {
    const mockWorker = {
      stop: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 50));
      })
    };

    const logs: Array<{ level: string; event: string }> = [];
    const exitFn = vi.fn();

    const shutdown = createWorkerShutdownHandler({
      worker: mockWorker,
      deadlineMs: 5000,
      exitFn,
      logger: (level, event) => {
        logs.push({ level, event });
      }
    });

    const p1 = shutdown("SIGTERM");
    const p2 = shutdown("SIGINT");

    await Promise.all([p1, p2]);

    expect(mockWorker.stop).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.event === "worker_shutdown_already_in_progress")).toBe(true);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("handles errors during worker shutdown and exits with code 1", async () => {
    const mockWorker = {
      stop: vi.fn(async () => {
        throw new Error("Worker cleanup failure");
      })
    };

    const logs: Array<{ level: string; event: string }> = [];
    const exitFn = vi.fn();

    const shutdown = createWorkerShutdownHandler({
      worker: mockWorker,
      deadlineMs: 5000,
      exitFn,
      logger: (level, event) => {
        logs.push({ level, event });
      }
    });

    await shutdown("SIGTERM");

    expect(exitFn).toHaveBeenCalledWith(1);
    expect(logs.some((l) => l.event === "worker_shutdown_error")).toBe(true);
  });

  it("triggers timeout deadline and exits with code 1 if worker stop hangs", async () => {
    vi.useFakeTimers();
    try {
      const mockWorker = {
        stop: vi.fn(async () => {
          // Never resolves
          await new Promise(() => {});
        })
      };

      const logs: Array<{ level: string; event: string }> = [];
      const exitFn = vi.fn();

      const shutdown = createWorkerShutdownHandler({
        worker: mockWorker,
        deadlineMs: 3000,
        exitFn,
        logger: (level, event) => {
          logs.push({ level, event });
        }
      });

      void shutdown("SIGTERM");

      vi.advanceTimersByTime(3500);

      expect(exitFn).toHaveBeenCalledWith(1);
      expect(logs.some((l) => l.event === "worker_shutdown_deadline_exceeded")).toBe(true);

      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
