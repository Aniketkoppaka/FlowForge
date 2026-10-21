import {
  type EditorNode,
  type EditorEdge,
  MAX_WORKFLOW_NODES,
  validateWorkflowExecutionReadiness
} from "@flowforge/contracts";
import type {
  ExecutionInput,
  ExecuteWorkflowOptions,
  ExecutionDataStore,
  NodeExecutionRecord,
  NodeHandler,
  WorkflowExecutionResult,
  StructuredExecutionError
} from "./types.js";
import { createDefaultNodeHandlerRegistry } from "./handlers.js";

function generateExecutionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type EdgePropagationState = "PENDING" | "ACTIVE" | "INACTIVE";

/**
 * Validates and executes a FlowForge workflow graph deterministically.
 *
 * Execution model:
 * 1. Runs `validateWorkflowExecutionReadiness(rawGraph)`. If invalid or incomplete, returns
 *    `status: "FAILED"` with code `"VALIDATION_FAILED"` before executing any node.
 * 2. Deep-clones all inputs (`validatedGraph` and `triggerPayload`) so the caller's graph
 *    or payload is never mutated.
 * 3. Iterates through `validatedGraph.topologicalOrder` (iterative loop, no unbounded recursion).
 * 4. For each node in topological order:
 *    - If its incoming edge is `INACTIVE` (because an upstream Condition selected the other
 *      branch or an upstream node failed/skipped), marks the node `SKIPPED` and propagates
 *      `INACTIVE` to all its outgoing edges.
 *    - Otherwise executes the registered node handler with a read-only `NodeHandlerContext`.
 *    - For `condition` nodes, activates only outgoing edges matching `selectedBranch` (`"true"` or `"false"`)
 *      and marks non-matching outgoing edges `INACTIVE`.
 *    - If a handler fails or throws, records the structured error on the node, marks its
 *      outgoing edges `INACTIVE` (blocking downstream nodes), and marks the overall workflow
 *      execution `FAILED`.
 */
export async function executeWorkflowGraph(
  rawGraph: unknown,
  input: ExecutionInput = {},
  options: ExecuteWorkflowOptions = {}
): Promise<WorkflowExecutionResult> {
  const clock = input.now ?? (() => new Date());
  const runStartDate = clock();
  const startedAt = runStartDate.toISOString();
  const executionId = input.executionId ?? generateExecutionId();
  const triggerPayload = structuredClone(input.triggerPayload ?? {});
  const maxSteps = options.maxSteps ?? MAX_WORKFLOW_NODES;

  // 1. Authoritative execution-readiness validation
  const readiness = validateWorkflowExecutionReadiness(rawGraph);
  if (!readiness.ready) {
    const completedDate = clock();
    return {
      executionId,
      workflowId: input.workflowId,
      status: "FAILED",
      startedAt,
      completedAt: completedDate.toISOString(),
      durationMs: Math.max(0, completedDate.getTime() - runStartDate.getTime()),
      triggerPayload,
      nodeResults: [],
      nodeOutputs: {},
      error: {
        code: "VALIDATION_FAILED",
        message: readiness.errors.map((e) => e.message).join(" "),
        details: readiness.errors
      }
    };
  }

  const graph = readiness.graph;
  const handlers = {
    ...createDefaultNodeHandlerRegistry(),
    ...(options.handlers ?? {})
  };

  // Index nodes and edges
  const nodeMap = new Map<string, EditorNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  const incomingEdgeByTarget = new Map<string, EditorEdge>();
  const outgoingEdgesBySource = new Map<string, EditorEdge[]>();
  for (const node of graph.nodes) {
    outgoingEdgesBySource.set(node.id, []);
  }
  for (const edge of graph.edges) {
    incomingEdgeByTarget.set(edge.target, edge);
    outgoingEdgesBySource.get(edge.source)?.push(edge);
  }

  // Track edge activation states
  const edgeState = new Map<string, EdgePropagationState>();
  const edgeSkipReason = new Map<string, string>();
  for (const edge of graph.edges) {
    edgeState.set(edge.id, "PENDING");
  }

  const dataStore: ExecutionDataStore = {
    trigger: {
      triggeredAt: startedAt,
      payload: structuredClone(triggerPayload)
    },
    nodes: {},
    input: {}
  };

  const nodeResults: NodeExecutionRecord[] = [];
  const nodeOutputs: Record<string, Record<string, unknown>> = {};
  let workflowError: StructuredExecutionError | undefined;
  let stepsExecuted = 0;

  for (const nodeId of graph.topologicalOrder) {
    const node = nodeMap.get(nodeId)!;
    const incomingEdge = incomingEdgeByTarget.get(nodeId) ?? null;
    const outgoingEdges = outgoingEdgesBySource.get(nodeId) ?? [];

    // Check if this node is on an inactive branch or blocked by an upstream failure
    if (incomingEdge && edgeState.get(incomingEdge.id) === "INACTIVE") {
      const reason =
        edgeSkipReason.get(incomingEdge.id) ??
        "Skipped because upstream branch was not selected.";

      nodeResults.push({
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "SKIPPED",
        startedAt: null,
        completedAt: null,
        durationMs: null,
        input: null,
        output: null,
        skipReason: reason
      });

      // Cascade INACTIVE to all outgoing edges of this skipped node
      for (const outEdge of outgoingEdges) {
        edgeState.set(outEdge.id, "INACTIVE");
        edgeSkipReason.set(outEdge.id, reason);
      }
      continue;
    }

    stepsExecuted += 1;
    if (stepsExecuted > maxSteps) {
      workflowError = {
        code: "MAX_STEPS_EXCEEDED",
        nodeId: node.id,
        message: `Execution exceeded maximum step limit (${maxSteps}).`
      };
      break;
    }

    const upstreamNodeId = incomingEdge ? incomingEdge.source : null;
    const upstreamOutput = upstreamNodeId
      ? structuredClone(nodeOutputs[upstreamNodeId] ?? {})
      : structuredClone(triggerPayload);

    // Update direct `input` reference for this node's execution
    dataStore.input = structuredClone(upstreamOutput);

    const nodeStartDate = clock();
    const nodeStartedAt = nodeStartDate.toISOString();

    const handler = handlers[node.type] as NodeHandler | undefined;
    if (!handler) {
      const err: StructuredExecutionError = {
        code: "HANDLER_NOT_REGISTERED",
        nodeId: node.id,
        message: `No execution handler registered for node type '${node.type}'.`
      };
      const nodeEndDate = clock();
      nodeResults.push({
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "FAILED",
        startedAt: nodeStartedAt,
        completedAt: nodeEndDate.toISOString(),
        durationMs: Math.max(0, nodeEndDate.getTime() - nodeStartDate.getTime()),
        input: structuredClone(upstreamOutput),
        output: null,
        error: err
      });
      workflowError = workflowError ?? err;

      for (const outEdge of outgoingEdges) {
        edgeState.set(outEdge.id, "INACTIVE");
        edgeSkipReason.set(
          outEdge.id,
          `Skipped because upstream node '${node.id}' failed.`
        );
      }
      continue;
    }

    try {
      const handlerResult = await handler(structuredClone(node), {
        executionId,
        workflowId: input.workflowId,
        node: structuredClone(node),
        upstreamNodeId,
        upstreamOutput: structuredClone(upstreamOutput),
        triggerPayload: structuredClone(triggerPayload),
        dataStore: structuredClone(dataStore),
        now: clock
      });

      const nodeEndDate = clock();
      const nodeCompletedAt = nodeEndDate.toISOString();
      const nodeDurationMs = Math.max(
        0,
        nodeEndDate.getTime() - nodeStartDate.getTime()
      );

      if (handlerResult.status === "FAILED") {
        nodeResults.push({
          nodeId: node.id,
          nodeType: node.type,
          label: node.label,
          status: "FAILED",
          startedAt: nodeStartedAt,
          completedAt: nodeCompletedAt,
          durationMs: nodeDurationMs,
          input: structuredClone(upstreamOutput),
          output: handlerResult.output ? structuredClone(handlerResult.output) : null,
          error: handlerResult.error
        });

        workflowError = workflowError ?? handlerResult.error;

        for (const outEdge of outgoingEdges) {
          edgeState.set(outEdge.id, "INACTIVE");
          edgeSkipReason.set(
            outEdge.id,
            `Skipped because upstream node '${node.id}' failed.`
          );
        }
        continue;
      }

      // If this is a condition node, ensure a valid branch was returned
      if (node.type === "condition") {
        if (
          handlerResult.selectedBranch !== "true" &&
          handlerResult.selectedBranch !== "false"
        ) {
          const branchErr: StructuredExecutionError = {
            code: "INVALID_BRANCH_RESULT",
            nodeId: node.id,
            message: `Condition node '${node.id}' did not return a valid 'true' or 'false' branch selection.`
          };
          nodeResults.push({
            nodeId: node.id,
            nodeType: node.type,
            label: node.label,
            status: "FAILED",
            startedAt: nodeStartedAt,
            completedAt: nodeCompletedAt,
            durationMs: nodeDurationMs,
            input: structuredClone(upstreamOutput),
            output: null,
            error: branchErr
          });
          workflowError = workflowError ?? branchErr;

          for (const outEdge of outgoingEdges) {
            edgeState.set(outEdge.id, "INACTIVE");
            edgeSkipReason.set(
              outEdge.id,
              `Skipped because upstream condition '${node.id}' failed.`
            );
          }
          continue;
        }
      }

      const safeOutput = structuredClone(handlerResult.output);
      nodeOutputs[node.id] = safeOutput;
      dataStore.nodes[node.id] = { output: structuredClone(safeOutput) };

      if (node.type === "manual_trigger") {
        const triggeredAtVal =
          typeof safeOutput.triggeredAt === "string"
            ? safeOutput.triggeredAt
            : startedAt;
        dataStore.trigger = {
          triggeredAt: triggeredAtVal,
          payload: structuredClone(triggerPayload)
        };
      }

      nodeResults.push({
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "COMPLETED",
        startedAt: nodeStartedAt,
        completedAt: nodeCompletedAt,
        durationMs: nodeDurationMs,
        input: structuredClone(upstreamOutput),
        output: safeOutput,
        selectedBranch: handlerResult.selectedBranch
      });

      // Propagate edge activation to outgoing edges
      for (const outEdge of outgoingEdges) {
        if (node.type === "condition") {
          if (outEdge.sourceHandle === handlerResult.selectedBranch) {
            edgeState.set(outEdge.id, "ACTIVE");
          } else {
            edgeState.set(outEdge.id, "INACTIVE");
            edgeSkipReason.set(
              outEdge.id,
              `Skipped because condition '${node.id}' evaluated to '${handlerResult.selectedBranch}' (branch '${outEdge.sourceHandle}' was not selected).`
            );
          }
        } else {
          edgeState.set(outEdge.id, "ACTIVE");
        }
      }
    } catch (caught) {
      const nodeEndDate = clock();
      const caughtMessage =
        caught instanceof Error ? caught.message : String(caught);
      const err: StructuredExecutionError = {
        code: "HANDLER_EXECUTION_ERROR",
        nodeId: node.id,
        message: `Node '${node.label}' (${node.id}) threw an unhandled error: ${caughtMessage}`
      };

      nodeResults.push({
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        status: "FAILED",
        startedAt: nodeStartedAt,
        completedAt: nodeEndDate.toISOString(),
        durationMs: Math.max(0, nodeEndDate.getTime() - nodeStartDate.getTime()),
        input: structuredClone(upstreamOutput),
        output: null,
        error: err
      });

      workflowError = workflowError ?? err;

      for (const outEdge of outgoingEdges) {
        edgeState.set(outEdge.id, "INACTIVE");
        edgeSkipReason.set(
          outEdge.id,
          `Skipped because upstream node '${node.id}' failed.`
        );
      }
    }
  }

  const runEndDate = clock();
  return {
    executionId,
    workflowId: input.workflowId,
    status: workflowError ? "FAILED" : "COMPLETED",
    startedAt,
    completedAt: runEndDate.toISOString(),
    durationMs: Math.max(0, runEndDate.getTime() - runStartDate.getTime()),
    triggerPayload,
    nodeResults,
    nodeOutputs,
    error: workflowError,
    validatedGraph: graph
  };
}
