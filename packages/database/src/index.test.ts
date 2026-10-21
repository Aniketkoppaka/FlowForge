import { describe, it, expect } from "vitest";
import { prisma } from "./index.js";

describe("@flowforge/database client", () => {
  it("exports an initialized PrismaClient instance with User, Session, and Workflow models", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
    expect(typeof prisma.user).toBe("object");
    expect(typeof prisma.session).toBe("object");
    expect(typeof prisma.workflow).toBe("object");
  });
});
