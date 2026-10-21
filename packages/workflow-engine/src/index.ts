/**
 * @flowforge/workflow-engine
 * Milestone 3: Authoritative Graph Validation & Deterministic Workflow Execution Engine.
 */

export const ENGINE_VERSION = "0.3.0" as const;

export * from "./types.js";
export * from "./data-flow.js";
export * from "./http-client.js";
export * from "./handlers.js";
export * from "./executor.js";
export {
  validateWorkflowExecutionReadiness,
  canonicalizeExecutableGraph,
  type ValidatedExecutableGraph,
  type ExecutionValidationError
} from "@flowforge/contracts";
