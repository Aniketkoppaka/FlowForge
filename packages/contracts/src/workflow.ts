import { z } from "zod";

export const MAX_WORKFLOW_NODES = 100;
export const MAX_WORKFLOW_EDGES = 200;

export const WorkflowNodeTypeEnum = z.enum([
  "manual_trigger",
  "http_request",
  "condition",
  "data_transform"
]);

export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeEnum>;

export const HttpMethodEnum = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethodEnum>;

export const ConditionOperatorEnum = z.enum([
  "equals",
  "not_equals",
  "contains",
  "exists"
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorEnum>;

export const HttpHeaderPairSchema = z.object({
  id: z.string().min(1),
  key: z.string(),
  value: z.string()
});
export type HttpHeaderPair = z.infer<typeof HttpHeaderPairSchema>;

export const DataMappingRowSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string(),
  targetKey: z.string()
});
export type DataMappingRow = z.infer<typeof DataMappingRowSchema>;

// Node-specific configuration schemas (Draft-tolerant for saving work-in-progress)
export const ManualTriggerDraftConfigSchema = z.object({
  description: z.string().max(500).default("")
});
export type ManualTriggerDraftConfig = z.infer<typeof ManualTriggerDraftConfigSchema>;

export const HttpRequestDraftConfigSchema = z.object({
  method: HttpMethodEnum.default("GET"),
  url: z.string().max(2048).default(""),
  headers: z.array(HttpHeaderPairSchema).max(50).default([]),
  body: z.string().max(50000).default("")
});
export type HttpRequestDraftConfig = z.infer<typeof HttpRequestDraftConfigSchema>;

export const ConditionDraftConfigSchema = z.object({
  leftOperand: z.string().max(500).default(""),
  operator: ConditionOperatorEnum.default("equals"),
  rightOperand: z.string().max(500).default("")
});
export type ConditionDraftConfig = z.infer<typeof ConditionDraftConfigSchema>;

export const DataTransformDraftConfigSchema = z.object({
  mappings: z.array(DataMappingRowSchema).max(100).default([])
});
export type DataTransformDraftConfig = z.infer<typeof DataTransformDraftConfigSchema>;

export const NodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});
export type NodePosition = z.infer<typeof NodePositionSchema>;

const BaseDraftNodeFields = {
  id: z.string().min(1).max(100),
  label: z.string().min(1, "Label is required").max(100),
  position: NodePositionSchema
};

export const ManualTriggerDraftNodeSchema = z.object({
  ...BaseDraftNodeFields,
  type: z.literal("manual_trigger"),
  config: ManualTriggerDraftConfigSchema.default({ description: "" })
});

export const HttpRequestDraftNodeSchema = z.object({
  ...BaseDraftNodeFields,
  type: z.literal("http_request"),
  config: HttpRequestDraftConfigSchema.default({
    method: "GET",
    url: "",
    headers: [],
    body: ""
  })
});

export const ConditionDraftNodeSchema = z.object({
  ...BaseDraftNodeFields,
  type: z.literal("condition"),
  config: ConditionDraftConfigSchema.default({
    leftOperand: "",
    operator: "equals",
    rightOperand: ""
  })
});

export const DataTransformDraftNodeSchema = z.object({
  ...BaseDraftNodeFields,
  type: z.literal("data_transform"),
  config: DataTransformDraftConfigSchema.default({
    mappings: []
  })
});

export const EditorNodeSchema = z.discriminatedUnion("type", [
  ManualTriggerDraftNodeSchema,
  HttpRequestDraftNodeSchema,
  ConditionDraftNodeSchema,
  DataTransformDraftNodeSchema
]);
export type EditorNode = z.infer<typeof EditorNodeSchema>;

export const SourceHandleEnum = z.enum(["default", "true", "false"]);
export type SourceHandle = z.infer<typeof SourceHandleEnum>;

export const TargetHandleEnum = z.enum(["default"]);
export type TargetHandle = z.infer<typeof TargetHandleEnum>;

export const EditorEdgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string().min(1).max(100),
  sourceHandle: SourceHandleEnum.default("default"),
  target: z.string().min(1).max(100),
  targetHandle: TargetHandleEnum.default("default")
});
export type EditorEdge = z.infer<typeof EditorEdgeSchema>;

/**
 * Validates whether a proposed connection between two nodes in the editor is legal
 * under the FlowForge Milestone 0.1 / Milestone 2 / Milestone 3 graph contract:
 * 1. Source and target nodes must exist.
 * 2. Self-loops are rejected.
 * 3. Manual Trigger cannot accept incoming edges.
 * 4. Condition nodes must use sourceHandle 'true' or 'false'; other nodes must use 'default'.
 * 5. No converging branches: target node cannot have >1 incoming edge.
 * 6. No duplicate connections.
 * 7. No directed cycles (must remain a valid DAG).
 */
export function validateGraphConnection(
  nodes: readonly EditorNode[],
  existingEdges: readonly EditorEdge[],
  candidate: {
    source: string;
    sourceHandle?: string | null;
    target: string;
    targetHandle?: string | null;
  }
): { valid: true } | { valid: false; reason: string } {
  const sourceNode = nodes.find((n) => n.id === candidate.source);
  const targetNode = nodes.find((n) => n.id === candidate.target);

  if (!sourceNode || !targetNode) {
    return { valid: false, reason: "Source or target node does not exist." };
  }

  if (candidate.source === candidate.target) {
    return { valid: false, reason: "Self-loops are not allowed." };
  }

  if (targetNode.type === "manual_trigger") {
    return { valid: false, reason: "Manual Trigger cannot have incoming connections." };
  }

  const normalizedSourceHandle = candidate.sourceHandle ?? "default";
  const normalizedTargetHandle = candidate.targetHandle ?? "default";

  if (normalizedTargetHandle !== "default") {
    return { valid: false, reason: `Invalid target handle '${normalizedTargetHandle}'.` };
  }

  if (sourceNode.type === "condition") {
    if (normalizedSourceHandle !== "true" && normalizedSourceHandle !== "false") {
      return {
        valid: false,
        reason: "Condition node outgoing connections must use the 'true' or 'false' handle."
      };
    }
  } else {
    if (normalizedSourceHandle !== "default") {
      return {
        valid: false,
        reason: `Node type '${sourceNode.type}' only supports the 'default' output handle.`
      };
    }
  }

  // Duplicate check
  const isDuplicate = existingEdges.some(
    (e) =>
      e.source === candidate.source &&
      e.target === candidate.target &&
      e.sourceHandle === normalizedSourceHandle
  );
  if (isDuplicate) {
    return { valid: false, reason: "Connection already exists." };
  }

  // Single incoming edge rule (no converging branches in MVP)
  const targetIncomingCount = existingEdges.filter((e) => e.target === candidate.target).length;
  if (targetIncomingCount >= 1) {
    return {
      valid: false,
      reason: "Converging branches are not supported in MVP: each node may have at most one incoming connection."
    };
  }

  // Cycle detection: check if 'source' is reachable from 'target' in existingEdges
  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const visited = new Set<string>();
  const stack: string[] = [candidate.target];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === candidate.source) {
      return { valid: false, reason: "Connection would create a cycle. Workflows must be acyclic (DAG)." };
    }
    if (!visited.has(curr)) {
      visited.add(curr);
      for (const next of adjacency.get(curr) ?? []) {
        if (!visited.has(next)) {
          stack.push(next);
        }
      }
    }
  }

  return { valid: true };
}

export interface NodeFieldValidationError {
  field: string;
  message: string;
}

/**
 * Evaluates field-level configuration warnings/errors for the editor configuration panel
 * and execution readiness checks.
 * These inform the user in the UI without blocking intermediate draft saving,
 * while blocking execution until resolved.
 */
export function validateNodeConfigForEditor(node: EditorNode): NodeFieldValidationError[] {
  const errors: NodeFieldValidationError[] = [];

  if (!node.label || node.label.trim().length === 0) {
    errors.push({ field: "label", message: "Node label is required." });
  }

  switch (node.type) {
    case "manual_trigger":
      break;

    case "http_request": {
      const url = node.config.url.trim();
      if (!url) {
        errors.push({ field: "url", message: "Request URL is required." });
      } else {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            errors.push({ field: "url", message: "URL must use http:// or https:// protocol." });
          }
        } catch {
          errors.push({ field: "url", message: "Enter a valid URL (e.g. https://api.example.com/v1)." });
        }
      }

      for (const header of node.config.headers) {
        if (header.value.trim().length > 0 && header.key.trim().length === 0) {
          errors.push({
            field: `header:${header.id}`,
            message: "Header name cannot be empty when a value is set."
          });
        }
      }
      break;
    }

    case "condition": {
      if (!node.config.leftOperand.trim()) {
        errors.push({
          field: "leftOperand",
          message: "Left operand / source path is required (e.g. trigger.payload.status)."
        });
      }
      if (node.config.operator !== "exists" && !node.config.rightOperand.trim()) {
        errors.push({
          field: "rightOperand",
          message: "Comparison value is required for the selected operator."
        });
      }
      break;
    }

    case "data_transform": {
      const seenKeys = new Set<string>();
      for (const row of node.config.mappings) {
        const src = row.sourcePath.trim();
        const tgt = row.targetKey.trim();
        if (!src || !tgt) {
          errors.push({
            field: `mapping:${row.id}`,
            message: "Both source path and output key are required."
          });
        } else if (seenKeys.has(tgt)) {
          errors.push({
            field: `mapping:${row.id}`,
            message: `Duplicate output key '${tgt}'.`
          });
        } else {
          seenKeys.add(tgt);
        }
      }
      break;
    }
  }

  return errors;
}

export function defaultNodeLabel(type: WorkflowNodeType): string {
  switch (type) {
    case "manual_trigger":
      return "Manual Trigger";
    case "http_request":
      return "HTTP Request";
    case "condition":
      return "Condition";
    case "data_transform":
      return "Data Transform";
  }
}

export function createDefaultEditorNode(
  type: WorkflowNodeType,
  id: string,
  position: NodePosition
): EditorNode {
  switch (type) {
    case "manual_trigger":
      return {
        id,
        type: "manual_trigger",
        label: "Manual Trigger",
        position,
        config: { description: "" }
      };
    case "http_request":
      return {
        id,
        type: "http_request",
        label: "HTTP Request",
        position,
        config: {
          method: "GET",
          url: "",
          headers: [],
          body: ""
        }
      };
    case "condition":
      return {
        id,
        type: "condition",
        label: "Condition",
        position,
        config: {
          leftOperand: "",
          operator: "equals",
          rightOperand: ""
        }
      };
    case "data_transform":
      return {
        id,
        type: "data_transform",
        label: "Data Transform",
        position,
        config: {
          mappings: []
        }
      };
  }
}

/**
 * Removes a node by ID and automatically prunes any connected incoming or outgoing edges.
 */
export function removeNodeAndConnectedEdges(
  nodes: readonly EditorNode[],
  edges: readonly EditorEdge[],
  nodeIdToRemove: string
): { nodes: EditorNode[]; edges: EditorEdge[] } {
  return {
    nodes: nodes.filter((n) => n.id !== nodeIdToRemove),
    edges: edges.filter((e) => e.source !== nodeIdToRemove && e.target !== nodeIdToRemove)
  };
}

/**
 * Updates a node's label and/or configuration in-place while strictly preserving its ID,
 * position, and all connected edges.
 */
export function updateNodePreserveIdentity(
  nodes: readonly EditorNode[],
  nodeId: string,
  updater: (node: EditorNode) => EditorNode
): EditorNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const updated = updater(node);
    // Guarantee ID and discriminant type cannot be mutated by configuration edits
    return {
      ...updated,
      id: node.id,
      type: node.type
    } as EditorNode;
  });
}

/**
 * Preprocess helper for draft nodes sent to the API:
 * Preserves support for minimal draft nodes (where label/position/config are omitted or position
 * is under legacy `presentation.position`) while strictly enforcing valid `WorkflowNodeTypeEnum`,
 * finite coordinates when provided, and valid node config shapes via `EditorNodeSchema`.
 */
const ApiDraftNodeSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const obj = raw as Record<string, unknown>;
  const typeResult = WorkflowNodeTypeEnum.safeParse(obj.type);
  if (!typeResult.success) {
    return raw; // Let EditorNodeSchema fail with discriminated union error
  }
  const validType = typeResult.data;

  // Resolve position from obj.position or legacy obj.presentation.position, or default if omitted
  let resolvedPosition: unknown = obj.position;
  if (resolvedPosition === undefined) {
    const pres = obj.presentation;
    if (pres && typeof pres === "object" && !Array.isArray(pres)) {
      resolvedPosition = (pres as Record<string, unknown>).position;
    }
  }
  if (resolvedPosition === undefined) {
    resolvedPosition = { x: 100, y: 100 };
  }

  // Resolve label (default to canonical node type label only when omitted)
  const resolvedLabel =
    obj.label === undefined ? defaultNodeLabel(validType) : obj.label;

  return {
    ...obj,
    label: resolvedLabel,
    position: resolvedPosition
  };
}, EditorNodeSchema);

/**
 * DraftDefinitionSchema used by API endpoints.
 * Enforces server-authoritative structural integrity:
 * - Supported `schemaVersion: 1`
 * - Max 100 nodes, max 200 edges
 * - Supported node types (`manual_trigger`, `http_request`, `condition`, `data_transform`)
 * - Finite position coordinates and valid per-node config shapes (while allowing incomplete field values)
 * - Unique node IDs and unique edge IDs
 * - At most 1 Manual Trigger node
 * - Valid source/target node references
 * - Valid source/target handles (Condition nodes MUST specify 'true' or 'false'; others 'default')
 * - Manual Trigger cannot receive incoming edges
 * - At most 1 incoming edge per node (no converging branches)
 * - No self-loops, duplicate connections, or directed cycles (DAG)
 */
export const DraftDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    nodes: z.array(ApiDraftNodeSchema).max(MAX_WORKFLOW_NODES).default([]),
    edges: z.array(EditorEdgeSchema).max(MAX_WORKFLOW_EDGES).default([])
  })
  .superRefine((val, ctx) => {
    const nodeIds = new Set<string>();
    const nodeMap = new Map<string, EditorNode>();
    let manualTriggerCount = 0;

    for (let i = 0; i < val.nodes.length; i++) {
      const n = val.nodes[i]!;
      const id = n.id.trim();
      if (!id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node at index ${i} is missing a valid string 'id'.`,
          path: ["nodes", i, "id"]
        });
        continue;
      }
      if (nodeIds.has(n.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node ID '${n.id}'.`,
          path: ["nodes", i, "id"]
        });
      }
      nodeIds.add(n.id);
      nodeMap.set(n.id, n);

      if (n.type === "manual_trigger") {
        manualTriggerCount++;
      }
    }

    if (manualTriggerCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A workflow may contain at most one Manual Trigger node.",
        path: ["nodes"]
      });
    }

    const edgeIds = new Set<string>();
    const seenConnections = new Set<string>();
    const incomingCount = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (let i = 0; i < val.edges.length; i++) {
      const e = val.edges[i]!;
      const id = e.id.trim();
      const source = e.source;
      const target = e.target;
      const sourceHandle = e.sourceHandle;

      if (!id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge at index ${i} is missing a valid string 'id'.`,
          path: ["edges", i, "id"]
        });
      } else if (edgeIds.has(e.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate edge ID '${e.id}'.`,
          path: ["edges", i, "id"]
        });
      } else {
        edgeIds.add(e.id);
      }

      const srcNode = nodeMap.get(source);
      const tgtNode = nodeMap.get(target);

      if (!srcNode || !tgtNode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge '${e.id || i}' references a nonexistent source or target node.`,
          path: ["edges", i]
        });
        continue;
      }

      if (source === target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Self-loop detected on node '${source}'.`,
          path: ["edges", i]
        });
      }

      if (tgtNode.type === "manual_trigger") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Manual Trigger '${target}' cannot accept incoming edges.`,
          path: ["edges", i]
        });
      }

      if (srcNode.type === "condition") {
        if (sourceHandle !== "true" && sourceHandle !== "false") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Condition node '${source}' outgoing edge must specify sourceHandle 'true' or 'false'.`,
            path: ["edges", i, "sourceHandle"]
          });
        }
      } else {
        if (sourceHandle !== "default") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Node '${source}' of type '${srcNode.type}' only supports sourceHandle 'default'.`,
            path: ["edges", i, "sourceHandle"]
          });
        }
      }

      const connectionKey = `${source}:${sourceHandle}->${target}:${e.targetHandle}`;
      if (seenConnections.has(connectionKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate connection '${connectionKey}'.`,
          path: ["edges", i]
        });
      }
      seenConnections.add(connectionKey);

      const nextIn = (incomingCount.get(target) ?? 0) + 1;
      incomingCount.set(target, nextIn);
      if (nextIn > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node '${target}' has multiple incoming edges. Converging branches are not supported in MVP.`,
          path: ["edges", i]
        });
      }

      const list = adjacency.get(source) ?? [];
      list.push(target);
      adjacency.set(source, list);
    }

    // Cycle check via Kahn's algorithm on referenced nodes
    const inDeg = new Map<string, number>();
    for (const id of nodeIds) {
      inDeg.set(id, incomingCount.get(id) ?? 0);
    }
    const q: string[] = [];
    for (const [id, d] of inDeg.entries()) {
      if (d === 0) q.push(id);
    }
    let visited = 0;
    while (q.length > 0) {
      const curr = q.shift()!;
      visited++;
      for (const nxt of adjacency.get(curr) ?? []) {
        const rem = (inDeg.get(nxt) ?? 1) - 1;
        inDeg.set(nxt, rem);
        if (rem === 0) q.push(nxt);
      }
    }
    if (visited < nodeIds.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Directed cycle detected in draft graph.",
        path: ["edges"]
      });
    }
  });

export type DraftDefinition = z.infer<typeof DraftDefinitionSchema>;

/**
 * Safely normalizes any stored `draftDefinition` JSON from the database into a clean,
 * validated `{ schemaVersion: 1, nodes: EditorNode[], edges: EditorEdge[] }` structure.
 *
 * Also returns `isCorrupted: boolean` whenever the stored JSON had malformed/unsupported
 * structure or pruned nodes/edges, enabling the editor to lock automatic/unconfirmed saves
 * so malformed stored data is never silently overwritten without explicit user recovery.
 */
export function normalizeDraftDefinition(raw: unknown): {
  schemaVersion: 1;
  nodes: EditorNode[];
  edges: EditorEdge[];
  warnings: string[];
  isCorrupted: boolean;
} {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("Stored workflow draft definition is not a valid JSON object.");
    return { schemaVersion: 1, nodes: [], edges: [], warnings, isCorrupted: true };
  }

  const obj = raw as { schemaVersion?: unknown; nodes?: unknown; edges?: unknown };
  if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1) {
    warnings.push(`Unsupported draft schemaVersion '${String(obj.schemaVersion)}'.`);
  }
  if (obj.nodes !== undefined && !Array.isArray(obj.nodes)) {
    warnings.push("Stored draft 'nodes' property is not an array.");
  }
  if (obj.edges !== undefined && !Array.isArray(obj.edges)) {
    warnings.push("Stored draft 'edges' property is not an array.");
  }

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: EditorNode[] = [];
  const seenNodeIds = new Set<string>();
  let hasManualTrigger = false;

  for (const item of rawNodes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push("Ignored malformed node entry.");
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const parsed = ApiDraftNodeSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`Ignored unsupported or invalid node '${String(candidate.id ?? "unknown")}'.`);
      continue;
    }

    if (seenNodeIds.has(parsed.data.id)) {
      warnings.push(`Ignored duplicate node ID '${parsed.data.id}'.`);
      continue;
    }

    if (parsed.data.type === "manual_trigger") {
      if (hasManualTrigger) {
        warnings.push("Ignored extra Manual Trigger node (at most one allowed).");
        continue;
      }
      hasManualTrigger = true;
    }

    seenNodeIds.add(parsed.data.id);
    nodes.push(parsed.data);
  }

  const edges: EditorEdge[] = [];
  const seenEdgeIds = new Set<string>();

  for (const item of rawEdges) {
    const parsed = EditorEdgeSchema.safeParse(item);
    if (!parsed.success) {
      warnings.push("Ignored malformed edge entry.");
      continue;
    }

    if (seenEdgeIds.has(parsed.data.id)) {
      warnings.push(`Ignored duplicate edge ID '${parsed.data.id}'.`);
      continue;
    }

    const check = validateGraphConnection(nodes, edges, {
      source: parsed.data.source,
      sourceHandle: parsed.data.sourceHandle,
      target: parsed.data.target,
      targetHandle: parsed.data.targetHandle
    });

    if (!check.valid) {
      warnings.push(`Ignored invalid edge '${parsed.data.id}': ${check.reason}`);
      continue;
    }

    seenEdgeIds.add(parsed.data.id);
    edges.push(parsed.data);
  }

  return {
    schemaVersion: 1,
    nodes,
    edges,
    warnings,
    isCorrupted: warnings.length > 0
  };
}

export interface ExecutionValidationError {
  code:
    | "INVALID_GRAPH_STRUCTURE"
    | "MISSING_TRIGGER"
    | "DISCONNECTED_NODE"
    | "INCOMPLETE_NODE_CONFIG"
    | "DETERMINISTIC_ORDER_FAILURE";
  message: string;
  nodeId?: string;
  field?: string;
}

export interface ValidatedExecutableGraph {
  schemaVersion: 1;
  triggerNodeId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  topologicalOrder: string[];
}

/**
 * Validates whether a workflow graph is completely valid and ready for execution.
 * Unlike `DraftDefinitionSchema` (which allows saving incomplete work-in-progress),
 * execution readiness requires:
 * 1. Full structural validity (`DraftDefinitionSchema`).
 * 2. Exactly one `manual_trigger` node as the entry point.
 * 3. Every node in the workflow is reachable from the `manual_trigger` node (no disconnected nodes).
 * 4. Every node has complete, valid configuration (`validateNodeConfigForEditor(node)` returns 0 errors).
 * 5. Every `condition` node has at least one outgoing branch edge ('true' or 'false').
 */
export function validateWorkflowExecutionReadiness(
  rawGraph: unknown
):
  | { ready: true; graph: ValidatedExecutableGraph }
  | { ready: false; errors: ExecutionValidationError[] } {
  const parsed = DraftDefinitionSchema.safeParse(rawGraph);
  if (!parsed.success) {
    return {
      ready: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "INVALID_GRAPH_STRUCTURE" as const,
        message: issue.message,
        field: issue.path.join(".")
      }))
    };
  }

  const { nodes, edges } = parsed.data;
  const errors: ExecutionValidationError[] = [];

  const triggerNodes = nodes.filter((n) => n.type === "manual_trigger");
  if (triggerNodes.length !== 1) {
    errors.push({
      code: "MISSING_TRIGGER",
      message: "Workflow requires exactly one Manual Trigger node to execute."
    });
    return { ready: false, errors };
  }

  const triggerNode = triggerNodes[0]!;

  // Build adjacency and incoming maps
  const adjacency = new Map<string, EditorEdge[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Reachability check from manual_trigger
  const reachable = new Set<string>();
  const bfsQueue: string[] = [triggerNode.id];
  while (bfsQueue.length > 0) {
    const curr = bfsQueue.shift()!;
    if (reachable.has(curr)) continue;
    reachable.add(curr);
    for (const outEdge of adjacency.get(curr) ?? []) {
      if (!reachable.has(outEdge.target)) {
        bfsQueue.push(outEdge.target);
      }
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      errors.push({
        code: "DISCONNECTED_NODE",
        nodeId: node.id,
        message: `Node '${node.label}' (${node.id}) is disconnected and not reachable from the Manual Trigger.`
      });
    }

    const fieldErrors = validateNodeConfigForEditor(node);
    for (const fe of fieldErrors) {
      errors.push({
        code: "INCOMPLETE_NODE_CONFIG",
        nodeId: node.id,
        field: fe.field,
        message: `Node '${node.label}' (${node.id}): ${fe.message}`
      });
    }

    if (node.type === "condition") {
      const outgoing = adjacency.get(node.id) ?? [];
      if (outgoing.length === 0) {
        errors.push({
          code: "INCOMPLETE_NODE_CONFIG",
          nodeId: node.id,
          field: "edges",
          message: `Condition node '${node.label}' (${node.id}) must have at least one outgoing branch ('true' or 'false').`
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ready: false, errors };
  }

  // Compute deterministic topological order (preserving node definition order for ties)
  const nodeOrderIndex = new Map<string, number>();
  nodes.forEach((n, idx) => nodeOrderIndex.set(n.id, idx));

  const readyQueue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort((a, b) => (nodeOrderIndex.get(a) ?? 0) - (nodeOrderIndex.get(b) ?? 0));

  const topologicalOrder: string[] = [];
  while (readyQueue.length > 0) {
    const curr = readyQueue.shift()!;
    topologicalOrder.push(curr);

    const outgoing = [...(adjacency.get(curr) ?? [])].sort(
      (a, b) => (nodeOrderIndex.get(a.target) ?? 0) - (nodeOrderIndex.get(b.target) ?? 0)
    );
    for (const edge of outgoing) {
      const nextDeg = (inDegree.get(edge.target) ?? 1) - 1;
      inDegree.set(edge.target, nextDeg);
      if (nextDeg === 0) {
        readyQueue.push(edge.target);
        readyQueue.sort(
          (a, b) => (nodeOrderIndex.get(a) ?? 0) - (nodeOrderIndex.get(b) ?? 0)
        );
      }
    }
  }

  if (topologicalOrder.length !== nodes.length) {
    return {
      ready: false,
      errors: [
        {
          code: "DETERMINISTIC_ORDER_FAILURE",
          message: "Unable to compute a complete topological execution order (graph contains a cycle)."
        }
      ]
    };
  }

  return {
    ready: true,
    graph: {
      schemaVersion: 1,
      triggerNodeId: triggerNode.id,
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      topologicalOrder
    }
  };
}

export const CreateWorkflowRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workflow name is required")
    .max(255, "Workflow name cannot exceed 255 characters"),
  description: z
    .string()
    .trim()
    .max(1000, "Description cannot exceed 1000 characters")
    .nullable()
    .optional(),
  draftDefinition: DraftDefinitionSchema.optional()
});

export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

export const UpdateWorkflowRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Workflow name cannot be empty")
      .max(255, "Workflow name cannot exceed 255 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Description cannot exceed 1000 characters")
      .nullable()
      .optional(),
    draftDefinition: DraftDefinitionSchema.optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field (name, description, or draftDefinition) must be provided for update"
  });

export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;

export const WorkflowResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  draftDefinition: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type WorkflowResponse = z.infer<typeof WorkflowResponseSchema>;
