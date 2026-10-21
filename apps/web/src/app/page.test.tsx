import { describe, it, expect } from "vitest";
import HomePage from "./page.js";

describe("@flowforge/web HomePage", () => {
  it("exports a valid React page component", () => {
    expect(typeof HomePage).toBe("function");
  });
});
