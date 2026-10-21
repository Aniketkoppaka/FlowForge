import { describe, it, expect } from "vitest";
import { getWorkerInfo } from "./index.js";

describe("@flowforge/worker skeleton", () => {
  it("returns worker metadata", () => {
    const info = getWorkerInfo();
    expect(info.service).toBe("@flowforge/worker");
    expect(info.engineVersion).toBe("0.3.0");
  });
});
