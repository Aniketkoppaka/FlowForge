import { describe, it, expect } from "vitest";
import {
  getWorkerInfo,
  computeWorkerBackoffMs,
  FlowForgeWorkerRuntime,
  WORKER_QUEUE_NAME
} from "./index.js";

describe("@flowforge/worker runtime suite", () => {
  it("returns worker metadata and queue name", () => {
    const info = getWorkerInfo();
    expect(info.service).toBe("@flowforge/worker");
    expect(info.engineVersion).toBe("0.3.0");
    expect(info.queueName).toBe(WORKER_QUEUE_NAME);
  });

  it("computes bounded exponential backoff with jitter", () => {
    const d1 = computeWorkerBackoffMs(1, 1000, 30_000);
    const d2 = computeWorkerBackoffMs(2, 1000, 30_000);
    const d10 = computeWorkerBackoffMs(10, 1000, 30_000);

    expect(d1).toBeGreaterThanOrEqual(1000);
    expect(d2).toBeGreaterThan(d1);
    expect(d10).toBeLessThanOrEqual(30_000);
  });

  it("initializes FlowForgeWorkerRuntime with bounded concurrency and clean lifecycle", async () => {
    const worker = new FlowForgeWorkerRuntime({
      workerId: "test_worker_1",
      concurrency: 6,
      pollIntervalMs: 5000,
      enableOutboundHttp: false
    });

    expect(worker.getStatus()).toMatchObject({
      service: "@flowforge/worker",
      workerId: "test_worker_1",
      running: false,
      activeJobs: 0,
      concurrency: 6,
      enableOutboundHttp: false
    });

    await worker.stop();
    expect(worker.getStatus().running).toBe(false);
  });
});
