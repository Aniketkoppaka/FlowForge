import type { ExecutionDataStore } from "./types.js";

export const MAX_DATA_PATH_DEPTH = 16;
export const MAX_DATA_PATH_LENGTH = 500;

const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor"
]);

export interface PathResolutionResult {
  found: boolean;
  value: unknown;
}

/**
 * Safely resolves a dot-separated path (with optional `[index]` bracket notation)
 * against the workflow execution data store without `eval`, `new Function`, or prototype traversal.
 *
 * Supported namespaces:
 * 1. `trigger.<path>` -> resolves inside `{ triggeredAt, payload }`
 * 2. `nodes.<nodeId>.output.<path>` (or `nodes.<nodeId>.<path>`) -> resolves from a specific upstream node's output
 * 3. `input.<path>` -> resolves from the direct upstream parent node's output
 * 4. `<relativePath>` -> fallback: checks `dataStore.input.<relativePath>` first, then `dataStore.trigger.payload.<relativePath>`
 *
 * Missing paths resolve deterministically to `{ found: false, value: undefined }`.
 */
export function resolveDataPath(
  dataStore: ExecutionDataStore,
  rawPath: string
): PathResolutionResult {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > MAX_DATA_PATH_LENGTH) {
    return { found: false, value: undefined };
  }

  // Normalize bracket indices like items[0].name -> items.0.name
  const normalized = trimmed.replace(/\[(\d+)\]/g, ".$1");
  const segments = normalized
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0 || segments.length > MAX_DATA_PATH_DEPTH) {
    return { found: false, value: undefined };
  }

  for (const seg of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg)) {
      return { found: false, value: undefined };
    }
  }

  const head = segments[0]!;

  if (head === "trigger") {
    return traverseObject(dataStore.trigger, segments.slice(1));
  }

  if (head === "input") {
    return traverseObject(dataStore.input, segments.slice(1));
  }

  if (head === "nodes") {
    if (segments.length < 2) {
      return { found: false, value: undefined };
    }
    const targetNodeId = segments[1]!;
    if (!Object.prototype.hasOwnProperty.call(dataStore.nodes, targetNodeId)) {
      return { found: false, value: undefined };
    }
    const nodeEntry = dataStore.nodes[targetNodeId];
    if (!nodeEntry) {
      return { found: false, value: undefined };
    }
    const rest = segments.slice(2);
    if (rest[0] === "output") {
      return traverseObject(nodeEntry.output, rest.slice(1));
    }
    return traverseObject(nodeEntry.output, rest);
  }

  // Relative path convenience: try direct parent `input` first, then `trigger.payload`
  const fromInput = traverseObject(dataStore.input, segments);
  if (fromInput.found) {
    return fromInput;
  }

  return traverseObject(dataStore.trigger.payload, segments);
}

function traverseObject(
  root: unknown,
  segments: readonly string[]
): PathResolutionResult {
  let current: unknown = root;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return { found: false, value: undefined };
    }

    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      return { found: false, value: undefined };
    }

    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[idx];
      continue;
    }

    if (typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return { found: false, value: undefined };
  }

  return {
    found: current !== undefined,
    value: current
  };
}
