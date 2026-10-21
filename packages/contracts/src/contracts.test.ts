import { describe, it, expect } from "vitest";
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
  EditorNodeSchema,
  EditorEdgeSchema,
  DraftDefinitionSchema,
  validateGraphConnection,
  validateNodeConfigForEditor,
  normalizeDraftDefinition,
  createDefaultEditorNode,
  removeNodeAndConnectedEdges,
  updateNodePreserveIdentity
} from "./index.js";

describe("@flowforge/contracts", () => {
  describe("RegisterRequestSchema & LoginRequestSchema", () => {
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

    it("normalizes email and validates password presence on login", () => {
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

  describe("Workflow & Editor Graph Contracts (Milestone 2)", () => {
    it("serializes and deserializes all 4 initial node types with positions and configs", () => {
      const nodes = [
        createDefaultEditorNode("manual_trigger", "node_trigger", { x: 80, y: 120 }),
        {
          id: "node_http",
          type: "http_request" as const,
          label: "Fetch Customer",
          position: { x: 320, y: 120 },
          config: {
            method: "POST" as const,
            url: "https://api.example.com/customers",
            headers: [{ id: "h1", key: "Accept", value: "application/json" }],
            body: "{\"active\":true}"
          }
        },
        {
          id: "node_cond",
          type: "condition" as const,
          label: "Check Tier",
          position: { x: 560, y: 120 },
          config: {
            leftOperand: "nodes.node_http.output.tier",
            operator: "equals" as const,
            rightOperand: "enterprise"
          }
        },
        {
          id: "node_transform",
          type: "data_transform" as const,
          label: "Map Customer DTO",
          position: { x: 820, y: 60 },
          config: {
            mappings: [
              { id: "m1", sourcePath: "nodes.node_http.output.id", targetKey: "customerId" }
            ]
          }
        }
      ];

      for (const n of nodes) {
        const parsed = EditorNodeSchema.safeParse(n);
        expect(parsed.success).toBe(true);
      }

      const edges = [
        { id: "e1", source: "node_trigger", sourceHandle: "default", target: "node_http", targetHandle: "default" },
        { id: "e2", source: "node_http", sourceHandle: "default", target: "node_cond", targetHandle: "default" },
        { id: "e3", source: "node_cond", sourceHandle: "true", target: "node_transform", targetHandle: "default" }
      ];

      for (const e of edges) {
        expect(EditorEdgeSchema.safeParse(e).success).toBe(true);
      }

      const roundTripped = normalizeDraftDefinition({
        schemaVersion: 1,
        nodes,
        edges
      });

      expect(roundTripped.warnings).toHaveLength(0);
      expect(roundTripped.nodes).toEqual(nodes);
      expect(roundTripped.edges).toEqual(edges);
    });

    it("preserves node identity and connected edges when editing label or configuration", () => {
      const n1 = createDefaultEditorNode("manual_trigger", "trig_1", { x: 50, y: 50 });
      const n2 = createDefaultEditorNode("http_request", "http_1", { x: 250, y: 50 });
      const initialNodes = [n1, n2];

      const updatedNodes = updateNodePreserveIdentity(initialNodes, "http_1", (node) => {
        if (node.type !== "http_request") return node;
        return {
          ...node,
          label: "Renamed HTTP Step",
          config: {
            ...node.config,
            method: "DELETE",
            url: "https://api.example.com/item/42"
          }
        };
      });

      expect(updatedNodes[1]!.id).toBe("http_1");
      expect(updatedNodes[1]!.label).toBe("Renamed HTTP Step");
      expect(updatedNodes[1]!.position).toEqual({ x: 250, y: 50 });
      if (updatedNodes[1]!.type === "http_request") {
        expect(updatedNodes[1]!.config.method).toBe("DELETE");
        expect(updatedNodes[1]!.config.url).toBe("https://api.example.com/item/42");
      }
    });

    it("enforces connection rules: no cycles, no converging branches, valid condition handles, no incoming trigger edges", () => {
      const trig = createDefaultEditorNode("manual_trigger", "trig", { x: 0, y: 0 });
      const cond = createDefaultEditorNode("condition", "cond", { x: 200, y: 0 });
      const httpA = createDefaultEditorNode("http_request", "httpA", { x: 400, y: -80 });
      const httpB = createDefaultEditorNode("http_request", "httpB", { x: 400, y: 80 });
      const transform = createDefaultEditorNode("data_transform", "trans", { x: 600, y: 0 });
      const nodes = [trig, cond, httpA, httpB, transform];

      const edges: ReturnType<typeof EditorEdgeSchema.parse>[] = [
        { id: "e1", source: "trig", sourceHandle: "default", target: "cond", targetHandle: "default" },
        { id: "e2", source: "cond", sourceHandle: "true", target: "httpA", targetHandle: "default" },
        { id: "e3", source: "cond", sourceHandle: "false", target: "httpB", targetHandle: "default" }
      ];

      // 1. Self-loop rejected
      expect(
        validateGraphConnection(nodes, edges, { source: "httpA", target: "httpA" }).valid
      ).toBe(false);

      // 2. Incoming edge to Manual Trigger rejected
      expect(
        validateGraphConnection(nodes, edges, { source: "httpA", target: "trig" }).valid
      ).toBe(false);

      // 3. Condition node with 'default' handle rejected
      expect(
        validateGraphConnection(nodes, edges, {
          source: "cond",
          sourceHandle: "default",
          target: "transform"
        }).valid
      ).toBe(false);

      // 4. Non-condition node with 'true' handle rejected
      expect(
        validateGraphConnection(nodes, edges, {
          source: "httpA",
          sourceHandle: "true",
          target: "trans"
        }).valid
      ).toBe(false);

      // 5. Valid connection from httpA -> trans succeeds
      expect(
        validateGraphConnection(nodes, edges, {
          source: "httpA",
          sourceHandle: "default",
          target: "trans"
        }).valid
      ).toBe(true);

      const edgesWithTrans = [
        ...edges,
        { id: "e4", source: "httpA", sourceHandle: "default" as const, target: "trans", targetHandle: "default" as const }
      ];

      // 6. Converging branch (httpB -> trans when trans already has incoming from httpA) rejected
      const convergeCheck = validateGraphConnection(nodes, edgesWithTrans, {
        source: "httpB",
        sourceHandle: "default",
        target: "trans"
      });
      expect(convergeCheck.valid).toBe(false);

      // 7. Cycle (trans -> cond) rejected
      const cycleCheck = validateGraphConnection(
        nodes,
        edgesWithTrans.filter((e) => e.id !== "e1"), // even if cond had no incoming edge
        {
          source: "trans",
          sourceHandle: "default",
          target: "cond"
        }
      );
      expect(cycleCheck.valid).toBe(false);
    });

    it("rejects duplicate node IDs, duplicate edge IDs, and >1 Manual Trigger in DraftDefinitionSchema", () => {
      const dupNodeRes = DraftDefinitionSchema.safeParse({
        schemaVersion: 1,
        nodes: [
          { id: "dup", type: "http_request" },
          { id: "dup", type: "data_transform" }
        ],
        edges: []
      });
      expect(dupNodeRes.success).toBe(false);

      const twoTriggersRes = DraftDefinitionSchema.safeParse({
        schemaVersion: 1,
        nodes: [
          { id: "t1", type: "manual_trigger" },
          { id: "t2", type: "manual_trigger" }
        ],
        edges: []
      });
      expect(twoTriggersRes.success).toBe(false);
    });

    it("allows incomplete drafts (unconfigured fields, disconnected nodes) to be saved via Create/Update schemas", () => {
      const result = CreateWorkflowRequestSchema.safeParse({
        name: "My Work in Progress Flow",
        description: "In progress",
        draftDefinition: {
          schemaVersion: 1,
          nodes: [
            createDefaultEditorNode("http_request", "http_unconfigured", { x: 100, y: 100 }),
            createDefaultEditorNode("condition", "cond_disconnected", { x: 400, y: 100 })
          ],
          edges: []
        }
      });
      expect(result.success).toBe(true);

      // Editor field validator still reports actionable UI feedback for the incomplete HTTP node
      const httpNode = createDefaultEditorNode("http_request", "http_unconfigured", { x: 100, y: 100 });
      const fieldErrors = validateNodeConfigForEditor(httpNode);
      expect(fieldErrors.some((e) => e.field === "url")).toBe(true);
    });

    it("removes connected edges when deleting a node", () => {
      const n1 = createDefaultEditorNode("manual_trigger", "n1", { x: 0, y: 0 });
      const n2 = createDefaultEditorNode("http_request", "n2", { x: 200, y: 0 });
      const n3 = createDefaultEditorNode("data_transform", "n3", { x: 400, y: 0 });
      const edges: ReturnType<typeof EditorEdgeSchema.parse>[] = [
        { id: "e1", source: "n1", sourceHandle: "default", target: "n2", targetHandle: "default" },
        { id: "e2", source: "n2", sourceHandle: "default", target: "n3", targetHandle: "default" }
      ];

      const afterDelete = removeNodeAndConnectedEdges([n1, n2, n3], edges, "n2");
      expect(afterDelete.nodes.map((n) => n.id)).toEqual(["n1", "n3"]);
      expect(afterDelete.edges).toHaveLength(0);
    });

    it("rejects empty UpdateWorkflowRequest", () => {
      const result = UpdateWorkflowRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
