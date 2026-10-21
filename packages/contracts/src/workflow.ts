import { z } from "zod";

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
  headers: z.array(HttpHeaderPairSchema).default([]),
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
  mappings: z.array(DataMappingRowSchema).default([])
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
 * under the FlowForge Milestone 0.1 / Milestone 2 graph contract:
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
 * Evaluates field-level configuration warnings/errors for the editor configuration panel.
 * These inform the user in the UI without blocking intermediate draft saving.
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

/**
 * Safely normalizes any stored `draftDefinition` JSON from the database into a clean,
 * validated `{ schemaVersion: 1, nodes: EditorNode[], edges: EditorEdge[] }` structure,
 * filtering out malformed legacy records or dangling edges without crashing the editor.
 */
export function normalizeDraftDefinition(raw: unknown): {
  schemaVersion: 1;
  nodes: EditorNode[];
  edges: EditorEdge[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { schemaVersion: 1, nodes: [], edges: [], warnings };
  }

  const obj = raw as { nodes?: unknown; edges?: unknown };
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: EditorNode[] = [];
  const seenNodeIds = new Set<string>();
  let hasManualTrigger = false;

  for (const item of rawNodes) {
    if (!item || typeof item !== "object") {
      warnings.push("Ignored malformed node entry.");
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const normalizedCandidate = {
      id: typeof candidate.id === "string" ? candidate.id : "",
      type: candidate.type,
      label:
        typeof candidate.label === "string" && candidate.label.trim().length > 0
          ? candidate.label
          : typeof candidate.type === "string"
            ? defaultNodeLabel(candidate.type as WorkflowNodeType)
            : "Node",
      position:
        candidate.position &&
        typeof candidate.position === "object" &&
        typeof (candidate.position as { x?: unknown }).x === "number" &&
        typeof (candidate.position as { y?: unknown }).y === "number"
          ? candidate.position
          : { x: 120 + nodes.length * 40, y: 120 + nodes.length * 40 },
      config:
        candidate.config && typeof candidate.config === "object" ? candidate.config : undefined
    };

    const parsed = EditorNodeSchema.safeParse(normalizedCandidate);
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
    warnings
  };
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
 * DraftDefinitionSchema used by API endpoints.
 * Validates structural integrity (unique node IDs, unique edge IDs, at most 1 Manual Trigger,
 * valid handles, no converging branches, no cycles) while still allowing incomplete node
 * field configurations or legacy/minimal test nodes to be saved as drafts.
 */
export const DraftDefinitionSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(1),
    nodes: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
    edges: z.array(z.record(z.string(), z.unknown())).max(200).default([])
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const nodeIds = new Set<string>();
    const nodeTypes = new Map<string, string>();
    let manualTriggerCount = 0;

    for (let i = 0; i < val.nodes.length; i++) {
      const n = val.nodes[i]!;
      const id = n.id;
      if (typeof id !== "string" || id.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node at index ${i} is missing a valid string 'id'.`,
          path: ["nodes", i, "id"]
        });
        continue;
      }
      if (nodeIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node ID '${id}'.`,
          path: ["nodes", i, "id"]
        });
      }
      nodeIds.add(id);

      const type = typeof n.type === "string" ? n.type : "unknown";
      nodeTypes.set(id, type);
      if (type === "manual_trigger") {
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
    const incomingCount = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (let i = 0; i < val.edges.length; i++) {
      const e = val.edges[i]!;
      const id = typeof e.id === "string" ? e.id : "";
      const source = typeof e.source === "string" ? e.source : "";
      const target = typeof e.target === "string" ? e.target : "";
      const sourceHandle = typeof e.sourceHandle === "string" ? e.sourceHandle : "default";

      if (!id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge at index ${i} is missing a valid string 'id'.`,
          path: ["edges", i, "id"]
        });
      } else if (edgeIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate edge ID '${id}'.`,
          path: ["edges", i, "id"]
        });
      } else {
        edgeIds.add(id);
      }

      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge '${id || i}' references a nonexistent source or target node.`,
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

      if (nodeTypes.get(target) === "manual_trigger") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Manual Trigger '${target}' cannot accept incoming edges.`,
          path: ["edges", i]
        });
      }

      const srcType = nodeTypes.get(source);
      if (srcType === "condition") {
        if (
          e.sourceHandle !== undefined &&
          sourceHandle !== "true" &&
          sourceHandle !== "false"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Condition node '${source}' outgoing edge must specify sourceHandle 'true' or 'false'.`,
            path: ["edges", i, "sourceHandle"]
          });
        }
      } else if (
        srcType &&
        ["manual_trigger", "http_request", "data_transform"].includes(srcType) &&
        sourceHandle !== "default"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Node '${source}' of type '${srcType}' only supports sourceHandle 'default'.`,
          path: ["edges", i, "sourceHandle"]
        });
      }

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
