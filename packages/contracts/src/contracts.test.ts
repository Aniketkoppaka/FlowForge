import { describe, it, expect } from "vitest";
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema
} from "./index.js";

describe("@flowforge/contracts", () => {
  describe("RegisterRequestSchema", () => {
    it("accepts valid email and password", () => {
      const result = RegisterRequestSchema.safeParse({
        email: "User@Example.com ",
        password: "securePassword123",
        name: "Alice"
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("user@example.com");
      }
    });

    it("rejects short password or invalid email", () => {
      expect(
        RegisterRequestSchema.safeParse({ email: "not-an-email", password: "123" }).success
      ).toBe(false);
    });
  });

  describe("LoginRequestSchema", () => {
    it("normalizes email and validates password presence", () => {
      const result = LoginRequestSchema.safeParse({
        email: "ADMIN@FLOWFORGE.IO",
        password: "secret"
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("admin@flowforge.io");
      }
    });
  });

  describe("Workflow Request Schemas", () => {
    it("allows draftDefinition with intermediate editor states", () => {
      const result = CreateWorkflowRequestSchema.safeParse({
        name: "My Draft Flow",
        description: "In progress",
        draftDefinition: {
          nodes: [{ id: "node-1", type: "unconfigured_draft_node" }],
          edges: []
        }
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty UpdateWorkflowRequest", () => {
      const result = UpdateWorkflowRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
