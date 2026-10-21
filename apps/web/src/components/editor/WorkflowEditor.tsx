"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type EditorNode,
  type EditorEdge,
  type WorkflowNodeType,
  normalizeDraftDefinition,
  createDefaultEditorNode,
  validateGraphConnection,
  removeNodeAndConnectedEdges,
  updateNodePreserveIdentity
} from "@flowforge/contracts";
import { apiClient, ApiClientError } from "../../lib/api";
import {
  FlowForgeCanvasNode,
  type FlowForgeNodeData
} from "./FlowForgeCanvasNode";
import { NodePalette } from "./NodePalette";
import { NodeConfigurationPanel } from "./NodeConfigurationPanel";

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

const NODE_TYPES = {
  flowforgeNode: FlowForgeCanvasNode
};

function generateStableId(prefix: string, existingIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomPart =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().split("-")[0]
        : Math.random().toString(36).slice(2, 10);
    const candidate = `${prefix}_${randomPart}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}_${Date.now()}`;
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState<string | null>(null);
  const [editorNodes, setEditorNodes] = useState<EditorNode[]>([]);
  const [editorEdges, setEditorEdges] = useState<EditorEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null);
  const [normalizationWarnings, setNormalizationWarnings] = useState<string[]>([]);

  // Monotonically increasing revision counter to prevent stale saves from clobbering newer edits
  const editRevisionRef = useRef(0);
  const inFlightSavePromiseRef = useRef<Promise<void> | null>(null);

  const markDirty = useCallback(() => {
    editRevisionRef.current += 1;
    setSaveStatus("unsaved");
    setSaveError(null);
  }, []);

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Ensure CSRF token is initialized if session is active
      try {
        await apiClient.getMe();
      } catch {
        // Handled below if getWorkflow returns 401
      }

      const res = await apiClient.getWorkflow(workflowId);
      const wf = res.workflow;
      const normalized = normalizeDraftDefinition(wf.draftDefinition);

      setWorkflowName(wf.name);
      setWorkflowDescription(wf.description);
      setEditorNodes(normalized.nodes);
      setEditorEdges(normalized.edges);
      setNormalizationWarnings(normalized.warnings);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      editRevisionRef.current = 0;
      setSaveStatus("saved");
      setSaveError(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setLoadError("Authentication required. Please sign in from the Workflows dashboard.");
      } else if (err instanceof ApiClientError && err.status === 404) {
        setLoadError("Workflow not found or you do not have access to it.");
      } else {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load workflow."
        );
      }
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  // Warn user before closing tab when draft has unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === "unsaved" || saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  const hasManualTrigger = useMemo(
    () => editorNodes.some((n) => n.type === "manual_trigger"),
    [editorNodes]
  );

  const selectedNode = useMemo(
    () => editorNodes.find((n) => n.id === selectedNodeId) ?? null,
    [editorNodes, selectedNodeId]
  );

  // Add Node Action
  const handleAddNode = useCallback(
    (type: WorkflowNodeType, dropPosition?: { x: number; y: number }) => {
      setConnectionFeedback(null);
      setEditorNodes((prev) => {
        if (type === "manual_trigger" && prev.some((n) => n.type === "manual_trigger")) {
          setConnectionFeedback("A workflow may contain at most one Manual Trigger.");
          return prev;
        }

        const existingIds = new Set(prev.map((n) => n.id));
        const newId = generateStableId(type, existingIds);
        const position = dropPosition ?? {
          x: 120 + (prev.length % 4) * 260,
          y: 120 + Math.floor(prev.length / 4) * 160
        };

        const newNode = createDefaultEditorNode(type, newId, position);
        setSelectedNodeId(newId);
        setSelectedEdgeId(null);
        markDirty();
        return [...prev, newNode];
      });
    },
    [markDirty]
  );

  // Update Node Label / Config (preserving ID and connected edges)
  const handleUpdateNode = useCallback(
    (nodeId: string, updater: (current: EditorNode) => EditorNode) => {
      setEditorNodes((prev) => updateNodePreserveIdentity(prev, nodeId, updater));
      markDirty();
    },
    [markDirty]
  );

  // Delete Node & Connected Edges
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setEditorNodes((prevNodes) => {
        setEditorEdges((prevEdges) => {
          const result = removeNodeAndConnectedEdges(prevNodes, prevEdges, nodeId);
          return result.edges;
        });
        return prevNodes.filter((n) => n.id !== nodeId);
      });
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      markDirty();
    },
    [markDirty, selectedNodeId]
  );

  // Delete Edge
  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEditorEdges((prev) => prev.filter((e) => e.id !== edgeId));
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
      }
      markDirty();
    },
    [markDirty, selectedEdgeId]
  );

  // Connect Handles
  const handleConnect = useCallback(
    (connection: Connection) => {
      setConnectionFeedback(null);
      if (!connection.source || !connection.target) return;

      const sourceHandle = (connection.sourceHandle ?? "default") as
        | "default"
        | "true"
        | "false";
      const targetHandle = (connection.targetHandle ?? "default") as "default";

      const validation = validateGraphConnection(editorNodes, editorEdges, {
        source: connection.source,
        sourceHandle,
        target: connection.target,
        targetHandle
      });

      if (!validation.valid) {
        setConnectionFeedback(validation.reason);
        return;
      }

      const existingIds = new Set(editorEdges.map((e) => e.id));
      const newEdge: EditorEdge = {
        id: generateStableId("edge", existingIds),
        source: connection.source,
        sourceHandle,
        target: connection.target,
        targetHandle: "default"
      };

      setEditorEdges((prev) => [...prev, newEdge]);
      markDirty();
    },
    [editorNodes, editorEdges, markDirty]
  );

  // React Flow Node Changes (position dragging, selection, removal)
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let positionMoved = false;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const pos = change.position;
          setEditorNodes((prev) =>
            prev.map((n) =>
              n.id === change.id
                ? {
                    ...n,
                    position: {
                      x: Math.round(pos.x),
                      y: Math.round(pos.y)
                    }
                  }
                : n
            )
          );
          if (change.dragging === false) {
            positionMoved = true;
          }
        } else if (change.type === "select") {
          if (change.selected) {
            setSelectedNodeId(change.id);
            setSelectedEdgeId(null);
          }
        } else if (change.type === "remove") {
          handleDeleteNode(change.id);
        }
      }

      if (positionMoved) {
        markDirty();
      }
    },
    [handleDeleteNode, markDirty]
  );

  // React Flow Edge Changes
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) {
            setSelectedEdgeId(change.id);
            setSelectedNodeId(null);
          }
        } else if (change.type === "remove") {
          handleDeleteEdge(change.id);
        }
      }
    },
    [handleDeleteEdge]
  );

  // Explicit Save Handler with Revision Tracking & Duplicate Request Prevention
  const handleSave = useCallback(async () => {
    if (inFlightSavePromiseRef.current) {
      return inFlightSavePromiseRef.current;
    }

    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      setSaveStatus("error");
      setSaveError("Workflow name cannot be empty.");
      return;
    }

    const snapshotRevision = editRevisionRef.current;
    const payload = {
      name: trimmedName,
      description: workflowDescription,
      draftDefinition: {
        schemaVersion: 1,
        nodes: editorNodes,
        edges: editorEdges
      }
    };

    setSaveStatus("saving");
    setSaveError(null);

    const savePromise = (async () => {
      try {
        const res = await apiClient.updateWorkflow(workflowId, payload);
        // Only transition to "saved" if no newer edits occurred while the request was in flight
        if (editRevisionRef.current === snapshotRevision) {
          setWorkflowName(res.workflow.name);
          setSaveStatus("saved");
          setSaveError(null);
        } else {
          setSaveStatus("unsaved");
        }
      } catch (err) {
        setSaveStatus("error");
        setSaveError(
          err instanceof Error ? err.message : "Failed to save workflow draft."
        );
      } finally {
        inFlightSavePromiseRef.current = null;
      }
    })();

    inFlightSavePromiseRef.current = savePromise;
    return savePromise;
  }, [workflowId, workflowName, workflowDescription, editorNodes, editorEdges]);

  // Convert EditorNodes / EditorEdges to React Flow format
  const rfNodes: Node<FlowForgeNodeData>[] = useMemo(
    () =>
      editorNodes.map((n) => ({
        id: n.id,
        type: "flowforgeNode",
        position: n.position,
        selected: n.id === selectedNodeId,
        data: {
          editorNode: n
        }
      })),
    [editorNodes, selectedNodeId]
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      editorEdges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        selected: e.id === selectedEdgeId,
        label:
          e.sourceHandle === "true"
            ? "TRUE"
            : e.sourceHandle === "false"
              ? "FALSE"
              : undefined,
        style: {
          stroke:
            e.sourceHandle === "true"
              ? "#22c55e"
              : e.sourceHandle === "false"
                ? "#ef4444"
                : "#38bdf8",
          strokeWidth: e.id === selectedEdgeId ? 3 : 2
        }
      })),
    [editorEdges, selectedEdgeId]
  );

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(
      "application/flowforge-node-type"
    ) as WorkflowNodeType;
    if (
      type === "manual_trigger" ||
      type === "http_request" ||
      type === "condition" ||
      type === "data_transform"
    ) {
      const bounds = event.currentTarget.getBoundingClientRect();
      handleAddNode(type, {
        x: Math.max(40, Math.round(event.clientX - bounds.left - 110)),
        y: Math.max(40, Math.round(event.clientY - bounds.top - 30))
      });
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ff-text-secondary)"
        }}
      >
        Loading workflow editor...
      </div>
    );
  }

  if (loadError) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center"
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: "480px",
            backgroundColor: "var(--ff-bg-surface)",
            border: "1px solid var(--ff-danger)",
            borderRadius: "10px",
            padding: "1.5rem"
          }}
        >
          <h1 style={{ fontSize: "1.2rem", margin: "0 0 0.5rem", color: "#fca5a5" }}>
            Unable to Open Workflow
          </h1>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.9rem", color: "var(--ff-text-secondary)" }}>
            {loadError}
          </p>
          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: "0.55rem 1rem",
              backgroundColor: "var(--ff-accent)",
              color: "#090d16",
              fontWeight: 700,
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "0.85rem"
            }}
          >
            ← Back to Workflows
          </Link>
        </div>
      </main>
    );
  }

  const statusBadge = (() => {
    switch (saveStatus) {
      case "saved":
        return { text: "Saved", color: "#4ade80", bg: "rgba(34, 197, 94, 0.14)" };
      case "unsaved":
        return { text: "Unsaved changes", color: "#fbbf24", bg: "rgba(245, 158, 11, 0.14)" };
      case "saving":
        return { text: "Saving...", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.14)" };
      case "error":
        return { text: "Save failed", color: "#f87171", bg: "rgba(239, 68, 68, 0.14)" };
    }
  })();

  return (
    <div className="ff-editor-shell">
      {/* A. Top Toolbar */}
      <header
        style={{
          height: "60px",
          flexShrink: 0,
          backgroundColor: "var(--ff-bg-surface)",
          borderBottom: "1px solid var(--ff-border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          gap: "1rem"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
          <Link
            href="/"
            aria-label="Back to Workflows"
            style={{
              padding: "0.35rem 0.65rem",
              backgroundColor: "var(--ff-bg-elevated)",
              border: "1px solid var(--ff-border-subtle)",
              borderRadius: "6px",
              color: "var(--ff-text-secondary)",
              fontSize: "0.8rem",
              textDecoration: "none",
              whiteSpace: "nowrap"
            }}
          >
            ← Workflows
          </Link>

          <span style={{ color: "var(--ff-border-subtle)" }}>/</span>

          <label htmlFor="workflow-title-input" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
            Workflow Name
          </label>
          <input
            id="workflow-title-input"
            type="text"
            aria-label="Workflow Name"
            value={workflowName}
            onChange={(e) => {
              setWorkflowName(e.target.value);
              markDirty();
            }}
            style={{
              padding: "0.35rem 0.6rem",
              backgroundColor: "var(--ff-bg-input)",
              border: "1px solid var(--ff-border-subtle)",
              borderRadius: "6px",
              color: "var(--ff-text-primary)",
              fontWeight: 700,
              fontSize: "0.95rem",
              minWidth: "200px"
            }}
          />

          <span
            data-testid="save-status-indicator"
            role="status"
            aria-live="polite"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "0.2rem 0.55rem",
              borderRadius: "999px",
              backgroundColor: statusBadge.bg,
              color: statusBadge.color,
              whiteSpace: "nowrap"
            }}
          >
            {statusBadge.text}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {selectedEdgeId && (
            <button
              type="button"
              onClick={() => handleDeleteEdge(selectedEdgeId)}
              style={{
                padding: "0.4rem 0.75rem",
                backgroundColor: "rgba(239, 68, 68, 0.14)",
                border: "1px solid var(--ff-danger)",
                borderRadius: "6px",
                color: "#fca5a5",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Delete Selected Edge
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saveStatus === "saving"}
            style={{
              padding: "0.45rem 1rem",
              backgroundColor: "var(--ff-accent)",
              color: "#090d16",
              fontWeight: 700,
              border: "none",
              borderRadius: "6px",
              fontSize: "0.85rem",
              cursor: saveStatus === "saving" ? "wait" : "pointer"
            }}
          >
            {saveStatus === "saving" ? "Saving..." : "Save Draft"}
          </button>

          <button
            type="button"
            disabled
            title="Workflow execution engine is scheduled for Milestone 3/4 and is not available in Milestone 2."
            aria-label="Run Workflow (Execution not implemented yet)"
            style={{
              padding: "0.45rem 0.9rem",
              backgroundColor: "var(--ff-bg-elevated)",
              color: "var(--ff-text-muted)",
              border: "1px solid var(--ff-border-subtle)",
              borderRadius: "6px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "not-allowed"
            }}
          >
            Run (Milestone 3)
          </button>
        </div>
      </header>

      {/* Banner for Save Errors, Connection Validation Feedback, or Legacy Normalization Warnings */}
      {(saveError || connectionFeedback || normalizationWarnings.length > 0) && (
        <div
          role="alert"
          style={{
            backgroundColor: saveError
              ? "rgba(239, 68, 68, 0.15)"
              : "rgba(245, 158, 11, 0.15)",
            borderBottom: saveError
              ? "1px solid var(--ff-danger)"
              : "1px solid var(--ff-warning)",
            padding: "0.5rem 1rem",
            fontSize: "0.8rem",
            color: saveError ? "#fca5a5" : "#fde68a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <div>
            {saveError && <strong>Save Error: {saveError} </strong>}
            {connectionFeedback && <span>{connectionFeedback} </span>}
            {normalizationWarnings.length > 0 && (
              <span>{normalizationWarnings.join(" ")}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setConnectionFeedback(null);
              setNormalizationWarnings([]);
            }}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "0.75rem",
              textDecoration: "underline"
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Editor Body: B. Node Palette + C. Main Canvas + D. Configuration Panel */}
      <div className="ff-editor-body">
        <NodePalette
          hasManualTrigger={hasManualTrigger}
          onAddNode={(type) => handleAddNode(type)}
        />

        <main
          className="ff-canvas-container"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          aria-label="Workflow Graph Canvas"
        >
          {editorNodes.length === 0 && (
            <div
              data-testid="empty-canvas-guidance"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 5,
                backgroundColor: "rgba(15, 23, 42, 0.92)",
                border: "1px dashed var(--ff-border-subtle)",
                borderRadius: "10px",
                padding: "1.75rem",
                maxWidth: "380px",
                textAlign: "center",
                pointerEvents: "none"
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
                Your workflow canvas is empty
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.82rem",
                  color: "var(--ff-text-secondary)",
                  lineHeight: 1.5
                }}
              >
                Start by clicking <strong>+ Add</strong> on{" "}
                <strong>Manual Trigger</strong> in the left palette to place your
                entry point, then add HTTP Request, Condition, or Data Transform
                steps.
              </p>
            </div>
          )}

          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            fitView
            colorMode="dark"
          >
            <Background color="#1e293b" gap={20} size={1} />
            <Controls />
            {editorNodes.length >= 3 && (
              <MiniMap
                pannable
                zoomable
                style={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155"
                }}
              />
            )}
          </ReactFlow>
        </main>

        {selectedNode && (
          <NodeConfigurationPanel
            node={selectedNode}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
