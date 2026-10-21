import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index.js";

describe("@flowforge/workflow-engine skeleton", () => {
  it("exports engine version constant", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
  });
});
