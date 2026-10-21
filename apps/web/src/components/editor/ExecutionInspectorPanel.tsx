"use client";

import React from "react";
import type {
  WorkflowRunResponse,
  NodeExecutionResponse
} from "@flowforge/contracts";

function runStatusBadgeStyle(status: WorkflowRunResponse["status"]) {
  switch (status) {
    case "COMPLETED":
      return { color: "#4ade80", bg: "rgba(34, 197, 94, 0.16)" };
    case "FAILED":
      return { color: "#f87171", bg: "rgba(239, 68, 68, 0.16)" };
    case "RUNNING":
      return { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.16)" };
    case "QUEUED":
      return { color: "#fbbf24", bg: "rgba(245, 158, 11, 0.16)" };
    case "CANCELLED":
      return { color: "#94a3b8", bg: "rgba(148, 163, 184, 0.16)" };
  }
}

function nodeStatusBadgeStyle(status: NodeExecutionResponse["status"]) {
  switch (status) {
    case "COMPLETED":
      return { color: "#4ade80", bg: "rgba(34, 197, 94, 0.15)" };
    case "FAILED":
      return { color: "#f87171", bg: "rgba(239, 68, 68, 0.15)" };
    case "RUNNING":
      return { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)" };
    case "SKIPPED":
      return { color: "#a8a29e", bg: "rgba(168, 162, 158, 0.15)" };
    case "PENDING":
      return { color: "#fbbf24", bg: "rgba(245, 158, 11, 0.15)" };
    case "CANCELLED":
      return { color: "#94a3b8", bg: "rgba(148, 163, 184, 0.15)" };
  }
}

function formatBoundedJson(value: unknown): { text: string; truncated: boolean } {
  if (value === null || value === undefined) {
    return { text: "null", truncated: false };
  }
  try {
    const str = JSON.stringify(value, null, 2);
    if (str.length > 1500) {
      return {
        text: `${str.slice(0, 1500)}\n... [Truncated for display]`,
        truncated: true
      };
    }
    return { text: str, truncated: false };
  } catch {
    return { text: String(value), truncated: false };
  }
}

export interface ExecutionInspectorPanelProps {
  runs: WorkflowRunResponse[];
  selectedRun: WorkflowRunResponse | null;
  onSelectRun: (runId: string) => void;
  onCancelRun: (runId: string) => void;
  onClose: () => void;
}

export function ExecutionInspectorPanel({
  runs,
  selectedRun,
  onSelectRun,
  onCancelRun,
  onClose
}: ExecutionInspectorPanelProps) {
  return (
    <aside
      data-testid="execution-inspector-panel"
      aria-label="Execution Inspector"
      style={{
        width: "380px",
        flexShrink: 0,
        backgroundColor: "var(--ff-bg-surface)",
        borderLeft: "1px solid var(--ff-border-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        padding: "1rem"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
          paddingBottom: "0.65rem",
          borderBottom: "1px solid var(--ff-border-subtle)"
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ff-accent)"
            }}
          >
            Observability
          </span>
          <h2 style={{ margin: "0.15rem 0 0", fontSize: "1rem" }}>
            Execution Inspector
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close Execution Inspector"
          style={{
            background: "transparent",
            border: "1px solid var(--ff-border-subtle)",
            borderRadius: "6px",
            color: "var(--ff-text-secondary)",
            padding: "0.25rem 0.55rem",
            fontSize: "0.75rem",
            cursor: "pointer"
          }}
        >
          Close
        </button>
      </div>

      {/* Run History Selector */}
      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "var(--ff-text-secondary)",
            marginBottom: "0.4rem"
          }}
        >
          Recent Runs ({runs.length})
        </div>
        {runs.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "var(--ff-text-muted)", margin: 0 }}>
            No runs recorded yet. Publish a version and click Run Workflow.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.35rem", maxHeight: "150px", overflowY: "auto" }}>
            {runs.map((r) => {
              const badge = runStatusBadgeStyle(r.status);
              const isSelected = selectedRun?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRun(r.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.45rem 0.6rem",
                    backgroundColor: isSelected
                      ? "rgba(56, 189, 248, 0.12)"
                      : "var(--ff-bg-elevated)",
                    border: isSelected
                      ? "1px solid var(--ff-accent)"
                      : "1px solid var(--ff-border-subtle)",
                    borderRadius: "6px",
                    color: "var(--ff-text-primary)",
                    fontSize: "0.76rem",
                    cursor: "pointer",
                    textAlign: "left"
                  }}
                >
                  <div>
                    <strong>v{r.versionNumber}</strong> · {r.id.slice(0, 8)}
                  </div>
                  <span
                    style={{
                      padding: "0.12rem 0.45rem",
                      borderRadius: "999px",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: badge.color,
                      backgroundColor: badge.bg
                    }}
                  >
                    {r.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Run Details */}
      {selectedRun && (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div
            style={{
              backgroundColor: "var(--ff-bg-elevated)",
              border: "1px solid var(--ff-border-subtle)",
              borderRadius: "8px",
              padding: "0.75rem",
              fontSize: "0.78rem"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <strong>Run {selectedRun.id.slice(0, 8)}</strong>
              <span
                data-testid="selected-run-status"
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  fontWeight: 700,
                  fontSize: "0.72rem",
                  color: runStatusBadgeStyle(selectedRun.status).color,
                  backgroundColor: runStatusBadgeStyle(selectedRun.status).bg
                }}
              >
                {selectedRun.status}
              </span>
            </div>

            <div style={{ color: "var(--ff-text-secondary)", display: "grid", gap: "0.2rem" }}>
              <div>Pinned Version: <strong>v{selectedRun.versionNumber}</strong></div>
              <div>Attempts: {selectedRun.attemptCount} / {selectedRun.maxAttempts}</div>
              {selectedRun.durationMs !== null && (
                <div>Duration: {selectedRun.durationMs} ms</div>
              )}
            </div>

            {selectedRun.error && (
              <div
                role="alert"
                style={{
                  marginTop: "0.5rem",
                  padding: "0.45rem 0.6rem",
                  backgroundColor: "rgba(239, 68, 68, 0.14)",
                  border: "1px solid var(--ff-danger)",
                  borderRadius: "6px",
                  color: "#fca5a5",
                  fontSize: "0.74rem"
                }}
              >
                <strong>{selectedRun.error.code}:</strong> {selectedRun.error.message}
              </div>
            )}

            {(selectedRun.status === "QUEUED" || selectedRun.status === "RUNNING") && (
              <button
                type="button"
                onClick={() => onCancelRun(selectedRun.id)}
                style={{
                  marginTop: "0.55rem",
                  width: "100%",
                  padding: "0.35rem 0.6rem",
                  backgroundColor: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid var(--ff-danger)",
                  borderRadius: "6px",
                  color: "#fca5a5",
                  fontWeight: 600,
                  fontSize: "0.75rem",
                  cursor: "pointer"
                }}
              >
                Cancel Run
              </button>
            )}
          </div>

          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--ff-text-secondary)"
            }}
          >
            Node Execution Timeline ({selectedRun.nodeExecutions?.length ?? 0})
          </div>

          <div style={{ display: "grid", gap: "0.6rem" }}>
            {(selectedRun.nodeExecutions ?? []).map((ne) => {
              const badge = nodeStatusBadgeStyle(ne.status);
              const formattedOut = ne.output ? formatBoundedJson(ne.output) : null;
              return (
                <div
                  key={ne.id}
                  data-testid={`node-exec-card-${ne.nodeId}`}
                  style={{
                    backgroundColor: "var(--ff-bg-elevated)",
                    border: "1px solid var(--ff-border-subtle)",
                    borderRadius: "8px",
                    padding: "0.65rem",
                    fontSize: "0.76rem"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{ne.label}</strong>
                    <span
                      style={{
                        padding: "0.1rem 0.45rem",
                        borderRadius: "999px",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        color: badge.color,
                        backgroundColor: badge.bg
                      }}
                    >
                      {ne.status}
                    </span>
                  </div>

                  <div style={{ fontSize: "0.7rem", color: "var(--ff-text-muted)", marginTop: "0.15rem" }}>
                    {ne.nodeType} ·Attempts: {ne.attemptCount}
                    {ne.durationMs !== null ? ` · ${ne.durationMs}ms` : ""}
                    {ne.selectedBranch ? ` · Branch: ${ne.selectedBranch.toUpperCase()}` : ""}
                  </div>

                  {ne.skipReason && (
                    <div
                      style={{
                        marginTop: "0.35rem",
                        fontSize: "0.72rem",
                        color: "#d6d3d1",
                        fontStyle: "italic"
                      }}
                    >
                      {ne.skipReason}
                    </div>
                  )}

                  {ne.error && (
                    <div
                      style={{
                        marginTop: "0.4rem",
                        padding: "0.4rem",
                        backgroundColor: "rgba(239, 68, 68, 0.14)",
                        border: "1px solid var(--ff-danger)",
                        borderRadius: "5px",
                        color: "#fca5a5",
                        fontSize: "0.72rem"
                      }}
                    >
                      <strong>{ne.error.code}:</strong> {ne.error.message}
                    </div>
                  )}

                  {formattedOut && (
                    <div style={{ marginTop: "0.45rem" }}>
                      <div style={{ fontSize: "0.68rem", color: "var(--ff-text-secondary)", marginBottom: "0.2rem" }}>
                        Output {formattedOut.truncated ? "(Truncated)" : ""}
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: "0.4rem",
                          backgroundColor: "#090d16",
                          borderRadius: "5px",
                          fontSize: "0.68rem",
                          overflowX: "auto",
                          maxHeight: "140px",
                          color: "#bae6fd"
                        }}
                      >
                        {formattedOut.text}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
