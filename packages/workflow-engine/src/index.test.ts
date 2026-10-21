import { describe, it, expect } from "vitest";
import {
  ENGINE_VERSION,
  executeWorkflowGraph,
  resolveDataPath,
  evaluateConditionOperator,
  isProhibitedIpAddress,
  validateTargetUrlSyntax,
  executeSafeHttpRequest,
  createDefaultNodeHandlerRegistry,
  type ExecutionDataStore
} from "./index.js";

describe("@flowforge/workflow-engine — Milestone 3 Validation & Execution Suite", () => {
  const fixedNow = () => new Date("2026-10-21T15:00:00.000Z");

  it("exports engine version constant", () => {
    expect(ENGINE_VERSION).toBe("0.3.0");
  });

  describe("1. Safe Path Resolution & Condition Operators (No eval / No prototype pollution)", () => {
    const sampleStore: ExecutionDataStore = {
      trigger: {
        triggeredAt: "2026-10-21T15:00:00.000Z",
        payload: {
          orderId: "ORD-9001",
          customer: {
            name: "Ada Lovelace",
            tier: "enterprise",
            tags: ["vip", "priority"]
          },
          total: 450
        }
      },
      nodes: {
        transform_1: {
          output: {
            normalizedOrderId: "ORD-9001",
            customerName: "Ada Lovelace"
          }
        }
      },
      input: {
        directValue: "from-parent"
      }
    };

    it("resolves trigger, nodes.<id>.output, input, array index, and relative paths deterministically", () => {
      expect(resolveDataPath(sampleStore, "trigger.payload.orderId")).toEqual({
        found: true,
        value: "ORD-9001"
      });
      expect(resolveDataPath(sampleStore, "trigger.payload.customer.tags[1]")).toEqual({
        found: true,
        value: "priority"
      });
      expect(resolveDataPath(sampleStore, "nodes.transform_1.output.customerName")).toEqual({
        found: true,
        value: "Ada Lovelace"
      });
      expect(resolveDataPath(sampleStore, "input.directValue")).toEqual({
        found: true,
        value: "from-parent"
      });
      // Relative path fallback to trigger.payload
      expect(resolveDataPath(sampleStore, "customer.tier")).toEqual({
        found: true,
        value: "enterprise"
      });
    });

    it("returns { found: false, value: undefined } for missing or forbidden prototype paths", () => {
      expect(resolveDataPath(sampleStore, "trigger.payload.nonExistent.field")).toEqual({
        found: false,
        value: undefined
      });
      expect(resolveDataPath(sampleStore, "trigger.payload.__proto__.toString")).toEqual({
        found: false,
        value: undefined
      });
      expect(resolveDataPath(sampleStore, "constructor.prototype")).toEqual({
        found: false,
        value: undefined
      });
    });

    it("evaluates equals, not_equals, contains, and exists operators accurately", () => {
      expect(evaluateConditionOperator(true, "enterprise", "equals", "enterprise")).toBe(true);
      expect(evaluateConditionOperator(true, 450, "equals", "450")).toBe(true);
      expect(evaluateConditionOperator(true, "starter", "not_equals", "enterprise")).toBe(true);
      expect(evaluateConditionOperator(true, ["vip", "priority"], "contains", "vip")).toBe(true);
      expect(evaluateConditionOperator(true, "hello world", "contains", "world")).toBe(true);
      expect(evaluateConditionOperator(true, "ORD-9001", "exists", "")).toBe(true);
      expect(evaluateConditionOperator(false, undefined, "exists", "")).toBe(false);
      expect(evaluateConditionOperator(true, null, "exists", "")).toBe(false);
    });
  });

  describe("2. Linear Workflow Execution & Upstream-to-Downstream Data Flow", () => {
    it("executes Manual Trigger -> Data Transform_1 -> Data Transform_2 and passes outputs downstream without mutating input graph", async () => {
      const inputGraph = {
        schemaVersion: 1,
        nodes: [
          {
            id: "trig_1",
            type: "manual_trigger",
            label: "Manual Start",
            position: { x: 0, y: 0 },
            config: { description: "Entry trigger" }
          },
          {
            id: "trans_1",
            type: "data_transform",
            label: "Extract User",
            position: { x: 240, y: 0 },
            config: {
              mappings: [
                { id: "m1", sourcePath: "trigger.payload.user.email", targetKey: "email" },
                { id: "m2", sourcePath: "trigger.payload.user.plan", targetKey: "plan" },
                { id: "m3", sourcePath: "trigger.payload.missingField", targetKey: "optionalField" }
              ]
            }
          },
          {
            id: "trans_2",
            type: "data_transform",
            label: "Build Account Summary",
            position: { x: 480, y: 0 },
            config: {
              mappings: [
                { id: "m4", sourcePath: "nodes.trans_1.output.email", targetKey: "accountEmail" },
                { id: "m5", sourcePath: "input.plan", targetKey: "activePlan" }
              ]
            }
          }
        ],
        edges: [
          { id: "e1", source: "trig_1", sourceHandle: "default", target: "trans_1", targetHandle: "default" },
          { id: "e2", source: "trans_1", sourceHandle: "default", target: "trans_2", targetHandle: "default" }
        ]
      };

      const graphSnapshotBefore = JSON.stringify(inputGraph);

      const result = await executeWorkflowGraph(inputGraph, {
        executionId: "exec_linear_1",
        workflowId: "wf_100",
        triggerPayload: {
          user: { email: "grace@hopper.org", plan: "pro" }
        },
        now: fixedNow
      });

      // Verify input graph was never mutated
      expect(JSON.stringify(inputGraph)).toBe(graphSnapshotBefore);

      expect(result.status).toBe("COMPLETED");
      expect(result.error).toBeUndefined();
      expect(result.nodeResults).toHaveLength(3);
      expect(result.nodeResults.map((r) => `${r.nodeId}:${r.status}`)).toEqual([
        "trig_1:COMPLETED",
        "trans_1:COMPLETED",
        "trans_2:COMPLETED"
      ]);

      expect(result.nodeOutputs["trans_1"]).toEqual({
        email: "grace@hopper.org",
        plan: "pro",
        optionalField: null
      });

      expect(result.nodeOutputs["trans_2"]).toEqual({
        accountEmail: "grace@hopper.org",
        activePlan: "pro"
      });
    });
  });

  describe("3. Conditional Branching & Cascading SKIPPED Semantics", () => {
    const branchingGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: "trig",
          type: "manual_trigger",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { description: "" }
        },
        {
          id: "cond_tier",
          type: "condition",
          label: "Is Enterprise?",
          position: { x: 200, y: 0 },
          config: {
            leftOperand: "trigger.payload.tier",
            operator: "equals",
            rightOperand: "enterprise"
          }
        },
        {
          id: "true_step_1",
          type: "data_transform",
          label: "Enterprise Transform 1",
          position: { x: 450, y: -80 },
          config: {
            mappings: [
              { id: "t1", sourcePath: "trigger.payload.company", targetKey: "vipCompany" }
            ]
          }
        },
        {
          id: "true_step_2",
          type: "data_transform",
          label: "Enterprise Transform 2",
          position: { x: 700, y: -80 },
          config: {
            mappings: [
              { id: "t2", sourcePath: "nodes.true_step_1.output.vipCompany", targetKey: "confirmedVip" }
            ]
          }
        },
        {
          id: "false_step_1",
          type: "data_transform",
          label: "Standard Transform 1",
          position: { x: 450, y: 80 },
          config: {
            mappings: [
              { id: "f1", sourcePath: "trigger.payload.company", targetKey: "standardCompany" }
            ]
          }
        }
      ],
      edges: [
        { id: "e1", source: "trig", sourceHandle: "default", target: "cond_tier", targetHandle: "default" },
        { id: "e2", source: "cond_tier", sourceHandle: "true", target: "true_step_1", targetHandle: "default" },
        { id: "e3", source: "true_step_1", sourceHandle: "default", target: "true_step_2", targetHandle: "default" },
        { id: "e4", source: "cond_tier", sourceHandle: "false", target: "false_step_1", targetHandle: "default" }
      ]
    };

    it("activates the 'true' branch and marks 'false' branch nodes as SKIPPED when condition matches", async () => {
      const res = await executeWorkflowGraph(branchingGraph, {
        triggerPayload: { tier: "enterprise", company: "Acme Corp" },
        now: fixedNow
      });

      expect(res.status).toBe("COMPLETED");
      const statusByNode = Object.fromEntries(
        res.nodeResults.map((r) => [r.nodeId, r.status])
      );
      expect(statusByNode).toEqual({
        trig: "COMPLETED",
        cond_tier: "COMPLETED",
        true_step_1: "COMPLETED",
        true_step_2: "COMPLETED",
        false_step_1: "SKIPPED"
      });

      expect(res.nodeOutputs["true_step_2"]).toEqual({ confirmedVip: "Acme Corp" });
      expect(res.nodeOutputs["false_step_1"]).toBeUndefined();
    });

    it("activates the 'false' branch and cascades SKIPPED across multi-step 'true' branch nodes when condition does not match", async () => {
      const res = await executeWorkflowGraph(branchingGraph, {
        triggerPayload: { tier: "free", company: "Startup LLC" },
        now: fixedNow
      });

      expect(res.status).toBe("COMPLETED");
      const statusByNode = Object.fromEntries(
        res.nodeResults.map((r) => [r.nodeId, r.status])
      );
      expect(statusByNode).toEqual({
        trig: "COMPLETED",
        cond_tier: "COMPLETED",
        true_step_1: "SKIPPED",
        true_step_2: "SKIPPED",
        false_step_1: "COMPLETED"
      });

      expect(res.nodeOutputs["false_step_1"]).toEqual({ standardCompany: "Startup LLC" });
      expect(res.nodeOutputs["true_step_1"]).toBeUndefined();
      expect(res.nodeOutputs["true_step_2"]).toBeUndefined();
    });
  });

  describe("4. Fail-Closed HTTP Request Handler & Downstream Blocking on Failure", () => {
    it("fails closed with NODE_NOT_SUPPORTED when executing an http_request node and skips downstream nodes", async () => {
      const graphWithHttp = {
        schemaVersion: 1,
        nodes: [
          {
            id: "trig",
            type: "manual_trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            config: { description: "" }
          },
          {
            id: "http_1",
            type: "http_request",
            label: "Call External Webhook",
            position: { x: 220, y: 0 },
            config: {
              method: "POST",
              url: "https://api.example.com/webhook",
              headers: [],
              body: "{}"
            }
          },
          {
            id: "after_http",
            type: "data_transform",
            label: "Post-HTTP Transform",
            position: { x: 460, y: 0 },
            config: {
              mappings: [{ id: "m1", sourcePath: "nodes.http_1.output.status", targetKey: "httpStatus" }]
            }
          }
        ],
        edges: [
          { id: "e1", source: "trig", sourceHandle: "default", target: "http_1", targetHandle: "default" },
          { id: "e2", source: "http_1", sourceHandle: "default", target: "after_http", targetHandle: "default" }
        ]
      };

      const res = await executeWorkflowGraph(graphWithHttp, {
        triggerPayload: { event: "ping" },
        now: fixedNow
      });

      expect(res.status).toBe("FAILED");
      expect(res.error?.code).toBe("NODE_NOT_SUPPORTED");
      expect(res.error?.nodeId).toBe("http_1");

      const statusByNode = Object.fromEntries(
        res.nodeResults.map((r) => [r.nodeId, r.status])
      );
      expect(statusByNode).toEqual({
        trig: "COMPLETED",
        http_1: "FAILED",
        after_http: "SKIPPED"
      });
    });

    it("skipped http_request node on an inactive condition branch does NOT fail the workflow", async () => {
      const graphWithInactiveHttp = {
        schemaVersion: 1,
        nodes: [
          {
            id: "trig",
            type: "manual_trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            config: { description: "" }
          },
          {
            id: "cond",
            type: "condition",
            label: "Should Call HTTP?",
            position: { x: 200, y: 0 },
            config: {
              leftOperand: "trigger.payload.callHttp",
              operator: "equals",
              rightOperand: "yes"
            }
          },
          {
            id: "http_node",
            type: "http_request",
            label: "Skipped HTTP",
            position: { x: 420, y: -60 },
            config: {
              method: "GET",
              url: "https://api.example.com/status",
              headers: [],
              body: ""
            }
          },
          {
            id: "safe_transform",
            type: "data_transform",
            label: "Local Transform",
            position: { x: 420, y: 60 },
            config: {
              mappings: [{ id: "m1", sourcePath: "trigger.payload.callHttp", targetKey: "mode" }]
            }
          }
        ],
        edges: [
          { id: "e1", source: "trig", sourceHandle: "default", target: "cond", targetHandle: "default" },
          { id: "e2", source: "cond", sourceHandle: "true", target: "http_node", targetHandle: "default" },
          { id: "e3", source: "cond", sourceHandle: "false", target: "safe_transform", targetHandle: "default" }
        ]
      };

      const res = await executeWorkflowGraph(graphWithInactiveHttp, {
        triggerPayload: { callHttp: "no" },
        now: fixedNow
      });

      expect(res.status).toBe("COMPLETED");
      expect(res.nodeOutputs["safe_transform"]).toEqual({ mode: "no" });
      expect(res.nodeResults.find((n) => n.nodeId === "http_node")?.status).toBe("SKIPPED");
    });
  });

  describe("5. Pre-Execution Validation Rejection", () => {
    it("rejects execution of a graph with a cycle, missing trigger, or disconnected node before running any handler", async () => {
      const disconnectedGraph = {
        schemaVersion: 1,
        nodes: [
          {
            id: "trig",
            type: "manual_trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            config: { description: "" }
          },
          {
            id: "orphan",
            type: "data_transform",
            label: "Orphan",
            position: { x: 200, y: 0 },
            config: {
              mappings: [{ id: "m1", sourcePath: "trigger.payload.x", targetKey: "y" }]
            }
          }
        ],
        edges: []
      };

      const res = await executeWorkflowGraph(disconnectedGraph, { now: fixedNow });
      expect(res.status).toBe("FAILED");
      expect(res.error?.code).toBe("VALIDATION_FAILED");
      expect(res.nodeResults).toHaveLength(0);
    });
  });

  describe("6. SSRF-Hardened HTTP Client Security & Regression Suite", () => {
    it("blocks loopback, RFC1918 private, link-local, cloud metadata, CGNAT, multicast, and IPv4-mapped IPv6 addresses", () => {
      const blockedIps = [
        "127.0.0.1",
        "127.255.255.254",
        "0.0.0.0",
        "10.0.0.1",
        "10.255.255.255",
        "172.16.0.1",
        "172.31.255.254",
        "192.168.0.1",
        "192.168.100.50",
        "169.254.169.254", // AWS/GCP/Azure Cloud Metadata
        "100.100.100.200", // Alibaba Cloud Metadata
        "100.64.0.1",      // CGNAT
        "198.18.0.1",      // Benchmarking
        "224.0.0.1",       // Multicast
        "255.255.255.255", // Broadcast
        "::1",
        "::",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::ffff:10.0.0.1",
        "fe80::1",
        "fc00::1",
        "fd00:ec2::254",   // AWS IPv6 Metadata
        "2001:db8::1"
      ];

      for (const ip of blockedIps) {
        const res = isProhibitedIpAddress(ip);
        expect(res.prohibited, `Expected IP '${ip}' to be prohibited`).toBe(true);
      }

      const publicIps = ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"];
      for (const ip of publicIps) {
        expect(isProhibitedIpAddress(ip).prohibited).toBe(false);
      }
    });

    it("rejects non-http protocols, embedded credentials, internal hostnames, and octal/hex IP encodings", () => {
      const forbiddenUrls = [
        "file:///etc/passwd",
        "ftp://example.com/data",
        "gopher://127.0.0.1:6379/_INFO",
        "https://user:password@example.com/api",
        "http://localhost:4000/api/health",
        "http://sub.localhost/admin",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://2130706433/",       // Decimal 127.0.0.1
        "http://0x7f000001/",       // Hex 127.0.0.1
        "http://0177.0.0.1/"        // Octal 127.0.0.1
      ];

      for (const badUrl of forbiddenUrls) {
        expect(() => validateTargetUrlSyntax(badUrl)).toThrow();
      }
    });

    it("blocks mixed public/private DNS answers to defeat DNS rebinding", async () => {
      await expect(
        executeSafeHttpRequest({
          method: "GET",
          url: "https://rebinding.example.com/webhook",
          resolveHostname: async () => [
            { address: "93.184.216.34", family: 4 },
            { address: "169.254.169.254", family: 4 } // Mixed metadata IP in DNS answer
          ]
        })
      ).rejects.toMatchObject({
        code: "SSRF_BLOCKED_IP"
      });
    });

    it("surfaces SSRF_BLOCKED_IP in WorkflowExecutionResult when hardened HTTP handler is enabled and targets a private IP", async () => {
      const ssrfGraph = {
        schemaVersion: 1,
        nodes: [
          {
            id: "trig",
            type: "manual_trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            config: { description: "" }
          },
          {
            id: "http_ssrf",
            type: "http_request",
            label: "Attempt Metadata Access",
            position: { x: 240, y: 0 },
            config: {
              method: "GET",
              url: "http://169.254.169.254/latest/meta-data/",
              headers: [],
              body: ""
            }
          }
        ],
        edges: [
          { id: "e1", source: "trig", sourceHandle: "default", target: "http_ssrf", targetHandle: "default" }
        ]
      };

      const res = await executeWorkflowGraph(
        ssrfGraph,
        { now: fixedNow },
        {
          handlers: createDefaultNodeHandlerRegistry({ enableOutboundHttp: true })
        }
      );

      expect(res.status).toBe("FAILED");
      expect(res.error?.code).toBe("SSRF_BLOCKED_IP");
      expect(res.error?.nodeId).toBe("http_ssrf");
    });
  });
});
