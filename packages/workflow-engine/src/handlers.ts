import type {
  EditorNode,
  ConditionOperator
} from "@flowforge/contracts";
import type {
  NodeHandler,
  NodeHandlerContext,
  NodeHandlerResult,
  NodeHandlerRegistry
} from "./types.js";
import { resolveDataPath } from "./data-flow.js";

type ManualTriggerNode = Extract<EditorNode, { type: "manual_trigger" }>;
type ConditionNode = Extract<EditorNode, { type: "condition" }>;
type DataTransformNode = Extract<EditorNode, { type: "data_transform" }>;
type HttpRequestNode = Extract<EditorNode, { type: "http_request" }>;

/**
 * 1. Manual Trigger Handler
 * Produces the initial execution context payload and timestamp.
 */
export const executeManualTriggerNode: NodeHandler<ManualTriggerNode> = (
  node,
  context
): NodeHandlerResult => {
  const triggeredAt = context.now().toISOString();
  const payload = structuredClone(context.triggerPayload);
  return {
    status: "COMPLETED",
    output: {
      nodeId: node.id,
      triggeredAt,
      description: node.config.description,
      payload
    }
  };
};

/**
 * Evaluates a Condition operator deterministically without `eval` or `new Function`.
 *
 * Semantics:
 * - `exists`: true when the resolved path exists and its value is neither `undefined` nor `null`.
 * - `equals`:
 *   - If leftValue is `undefined` or `null`, returns `false` unless rightOperand is literal `"null"` and leftValue is `null`.
 *   - Compares primitive values by exact match or canonical string representation (e.g., number `200` matches `"200"`, boolean `true` matches `"true"`).
 * - `not_equals`: logical negation of `equals`.
 * - `contains`:
 *   - If leftValue is a `string`, checks `leftValue.includes(rightOperand)`.
 *   - If leftValue is an `Array`, checks whether any element matches `rightOperand` by string/primitive equality.
 *   - Otherwise returns `false`.
 */
export function evaluateConditionOperator(
  leftFound: boolean,
  leftValue: unknown,
  operator: ConditionOperator,
  rightOperand: string
): boolean {
  switch (operator) {
    case "exists":
      return leftFound && leftValue !== undefined && leftValue !== null;

    case "equals":
      return valuesEqual(leftFound, leftValue, rightOperand);

    case "not_equals":
      return !valuesEqual(leftFound, leftValue, rightOperand);

    case "contains": {
      if (!leftFound || leftValue === undefined || leftValue === null) {
        return false;
      }
      if (typeof leftValue === "string") {
        return leftValue.includes(rightOperand);
      }
      if (Array.isArray(leftValue)) {
        return leftValue.some((item) => valuesEqual(true, item, rightOperand));
      }
      return false;
    }
  }
}

function valuesEqual(
  leftFound: boolean,
  leftValue: unknown,
  rightOperand: string
): boolean {
  if (!leftFound || leftValue === undefined) {
    return false;
  }
  if (leftValue === null) {
    return rightOperand === "null";
  }
  if (typeof leftValue === "string") {
    return leftValue === rightOperand;
  }
  if (typeof leftValue === "number" || typeof leftValue === "boolean") {
    return String(leftValue) === rightOperand.trim();
  }
  return false;
}

/**
 * 2. Condition Node Handler
 * Evaluates `leftOperand` path against `rightOperand` using the configured operator
 * and returns explicit `selectedBranch: "true" | "false"`.
 */
export const executeConditionNode: NodeHandler<ConditionNode> = (
  node,
  context
): NodeHandlerResult => {
  const { leftOperand, operator, rightOperand } = node.config;
  const resolved = resolveDataPath(context.dataStore, leftOperand);
  const matched = evaluateConditionOperator(
    resolved.found,
    resolved.value,
    operator,
    rightOperand
  );
  const selectedBranch: "true" | "false" = matched ? "true" : "false";

  return {
    status: "COMPLETED",
    selectedBranch,
    output: {
      matched,
      branch: selectedBranch,
      operator,
      leftOperand,
      leftValue: resolved.found ? structuredClone(resolved.value) : null,
      rightOperand
    }
  };
};

/**
 * 3. Data Transform Node Handler
 * Resolves each `sourcePath` from the execution data store and assigns it to `targetKey`.
 * Missing source paths resolve deterministically to `null`.
 */
export const executeDataTransformNode: NodeHandler<DataTransformNode> = (
  node,
  context
): NodeHandlerResult => {
  const transformed: Record<string, unknown> = {};

  for (const mapping of node.config.mappings) {
    const targetKey = mapping.targetKey.trim();
    const sourcePath = mapping.sourcePath.trim();
    if (!targetKey) continue;

    // Prevent prototype pollution keys on output object
    if (
      targetKey === "__proto__" ||
      targetKey === "prototype" ||
      targetKey === "constructor"
    ) {
      continue;
    }

    const resolved = resolveDataPath(context.dataStore, sourcePath);
    transformed[targetKey] =
      resolved.found && resolved.value !== undefined
        ? structuredClone(resolved.value)
        : null;
  }

  return {
    status: "COMPLETED",
    output: transformed
  };
};

/**
 * 4. HTTP Request Node Handler (Fail-Closed Contract in Milestone 3)
 * Defines the handler contract and input/output semantics, and fails closed with
 * `NODE_NOT_SUPPORTED` until the SSRF-hardened outbound HTTP client is enabled in Milestone 4/6.
 * Never performs unsafe outbound network calls or simulates fake 200 responses.
 */
export const executeHttpRequestNode: NodeHandler<HttpRequestNode> = (
  node,
  _context: NodeHandlerContext
): NodeHandlerResult => {
  return {
    status: "FAILED",
    error: {
      code: "NODE_NOT_SUPPORTED",
      nodeId: node.id,
      message: `HTTP Request node '${node.label}' (${node.id}) cannot execute: outbound HTTP requests are disabled until the SSRF-hardened HTTP client is enabled.`,
      details: {
        method: node.config.method,
        url: node.config.url
      }
    }
  };
};

export function createDefaultNodeHandlerRegistry(): NodeHandlerRegistry {
  return {
    manual_trigger: executeManualTriggerNode,
    condition: executeConditionNode,
    data_transform: executeDataTransformNode,
    http_request: executeHttpRequestNode
  };
}
