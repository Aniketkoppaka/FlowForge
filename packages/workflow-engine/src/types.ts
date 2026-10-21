import type {
  EditorNode,
  WorkflowNodeType,
  ExecutionValidationError,
  ValidatedExecutableGraph
} from "@flowforge/contracts";

export type NodeExecutionStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type WorkflowExecutionStatus = "COMPLETED" | "FAILED";

export type ExecutionErrorCode =
  | "VALIDATION_FAILED"
  | "NODE_NOT_SUPPORTED"
  | "SSRF_BLOCKED_URL"
  | "SSRF_BLOCKED_IP"
  | "SSRF_DNS_FAILURE"
  | "HTTP_REDIRECT_BLOCKED"
  | "HTTP_TIMEOUT"
  | "HTTP_RESPONSE_TOO_LARGE"
  | "HTTP_NETWORK_ERROR"
  | "HTTP_STATUS_ERROR"
  | "HANDLER_NOT_REGISTERED"
  | "HANDLER_EXECUTION_ERROR"
  | "INVALID_BRANCH_RESULT"
  | "MAX_STEPS_EXCEEDED"
  | "DATA_PATH_LIMIT_EXCEEDED";

export interface StructuredExecutionError {
  code: ExecutionErrorCode;
  message: string;
  nodeId?: string;
  details?: ReadonlyArray<ExecutionValidationError> | Record<string, unknown>;
}

/**
 * Input provided when starting a workflow execution run.
 */
export interface ExecutionInput {
  /**
   * Optional unique execution run identifier. Generated automatically if omitted.
   */
  executionId?: string;
  /**
   * Optional workflow identifier for tracing.
   */
  workflowId?: string;
  /**
   * Initial trigger payload injected into the Manual Trigger node.
   */
  triggerPayload?: Record<string, unknown>;
  /**
   * Optional deterministic clock source for reproducible timestamps in tests.
   */
  now?: () => Date;
}

/**
 * Execution data store exposed to downstream nodes via path resolution:
 * - `trigger`: `{ triggeredAt: string, payload: Record<string, unknown> }`
 * - `nodes`: `Record<nodeId, { output: Record<string, unknown> }>`
 * - `input`: Direct upstream parent node's output object (convenience alias)
 */
export interface ExecutionDataStore {
  trigger: {
    triggeredAt: string;
    payload: Record<string, unknown>;
  };
  nodes: Record<
    string,
    {
      output: Record<string, unknown>;
    }
  >;
  input: Record<string, unknown>;
}

/**
 * Read-only context supplied to a single node handler during execution.
 */
export interface NodeHandlerContext {
  readonly executionId: string;
  readonly workflowId?: string;
  readonly node: EditorNode;
  readonly upstreamNodeId: string | null;
  readonly upstreamOutput: Record<string, unknown>;
  readonly triggerPayload: Record<string, unknown>;
  readonly dataStore: ExecutionDataStore;
  readonly now: () => Date;
}

export type NodeHandlerResult =
  | {
      status: "COMPLETED";
      output: Record<string, unknown>;
      /**
       * Required when executing a `condition` node: specifies which outgoing
       * handle ('true' or 'false') is activated.
       */
      selectedBranch?: "true" | "false";
    }
  | {
      status: "FAILED";
      error: StructuredExecutionError;
      output?: Record<string, unknown>;
    };

export type NodeHandler<TNode extends EditorNode = EditorNode> = (
  node: TNode,
  context: NodeHandlerContext
) => Promise<NodeHandlerResult> | NodeHandlerResult;

export type NodeHandlerRegistry = {
  [K in WorkflowNodeType]?: NodeHandler<Extract<EditorNode, { type: K }>>;
};

export interface NodeExecutionRecord {
  nodeId: string;
  nodeType: WorkflowNodeType;
  label: string;
  status: NodeExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  selectedBranch?: "true" | "false";
  skipReason?: string;
  error?: StructuredExecutionError;
}

export interface WorkflowExecutionResult {
  executionId: string;
  workflowId?: string;
  status: WorkflowExecutionStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  triggerPayload: Record<string, unknown>;
  nodeResults: NodeExecutionRecord[];
  nodeOutputs: Record<string, Record<string, unknown>>;
  error?: StructuredExecutionError;
  validatedGraph?: ValidatedExecutableGraph;
}

export interface ExecuteWorkflowOptions {
  /**
   * Custom handler overrides (defaults to `createDefaultNodeHandlerRegistry()`).
   */
  handlers?: NodeHandlerRegistry;
  /**
   * Maximum number of node execution steps allowed in a single run. Defaults to 100.
   */
  maxSteps?: number;
}
