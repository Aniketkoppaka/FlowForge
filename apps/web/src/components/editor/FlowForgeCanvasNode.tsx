"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";
import type { EditorNode, WorkflowNodeType } from "@flowforge/contracts";
import { validateNodeConfigForEditor } from "@flowforge/contracts";

export interface FlowForgeNodeData extends Record<string, unknown> {
  editorNode: EditorNode;
}

const NODE_BADGE_COLORS: Record<WorkflowNodeType, { bg: string; text: string; tag: string }> = {
  manual_trigger: { bg: "rgba(34, 197, 94, 0.15)", text: "#4ade80", tag: "TRIGGER" },
  http_request: { bg: "rgba(56, 189, 248, 0.15)", text: "#38bdf8", tag: "HTTP" },
  condition: { bg: "rgba(245, 158, 11, 0.15)", text: "#fbbf24", tag: "BRANCH" },
  data_transform: { bg: "rgba(168, 85, 247, 0.15)", text: "#c084fc", tag: "TRANSFORM" }
};

function renderNodeSummary(node: EditorNode): string {
  switch (node.type) {
    case "manual_trigger":
      return node.config.description.trim() || "Manual workflow entry point";
    case "http_request": {
      const url = node.config.url.trim();
      return url ? `${node.config.method} ${url}` : `${node.config.method} (URL not configured)`;
    }
    case "condition": {
      const left = node.config.leftOperand.trim();
      if (!left) return "Condition expression not configured";
      if (node.config.operator === "exists") return `${left} exists`;
      return `${left} ${node.config.operator} ${node.config.rightOperand || "?"}`;
    }
    case "data_transform": {
      const count = node.config.mappings.length;
      return count === 0
        ? "No field mappings configured"
        : `${count} field ${count === 1 ? "mapping" : "mappings"}`;
    }
  }
}

export function FlowForgeCanvasNode({
  data,
  selected
}: {
  data: FlowForgeNodeData;
  selected?: boolean;
}) {
  const { editorNode } = data;
  const badge = NODE_BADGE_COLORS[editorNode.type];
  const validationErrors = validateNodeConfigForEditor(editorNode);
  const hasWarnings = validationErrors.length > 0;

  return (
    <div
      data-testid={`canvas-node-${editorNode.id}`}
      style={{
        minWidth: "230px",
        maxWidth: "270px",
        backgroundColor: "var(--ff-bg-surface)",
        border: selected
          ? "2px solid var(--ff-accent)"
          : hasWarnings
            ? "1px solid rgba(245, 158, 11, 0.65)"
            : "1px solid var(--ff-border-subtle)",
        borderRadius: "8px",
        padding: "0.75rem",
        boxShadow: selected
          ? "0 0 0 3px rgba(56, 189, 248, 0.2)"
          : "0 4px 12px rgba(0, 0, 0, 0.35)",
        color: "var(--ff-text-primary)",
        position: "relative"
      }}
    >
      {/* Target Handle (All nodes except Manual Trigger have a single incoming target handle) */}
      {editorNode.type !== "manual_trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          id="default"
          style={{
            width: "11px",
            height: "11px",
            backgroundColor: "var(--ff-accent)",
            border: "2px solid var(--ff-bg-surface)"
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBottom: "0.4rem"
        }}
      >
        <span
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "0.12rem 0.45rem",
            borderRadius: "4px",
            backgroundColor: badge.bg,
            color: badge.text
          }}
        >
          {badge.tag}
        </span>

        {hasWarnings && (
          <span
            title={validationErrors.map((e) => e.message).join(" ")}
            style={{
              fontSize: "0.68rem",
              color: "var(--ff-warning)",
              fontWeight: 600
            }}
          >
            ⚠ Config incomplete
          </span>
        )}
      </div>

      <div
        style={{
          fontWeight: 700,
          fontSize: "0.9rem",
          marginBottom: "0.25rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {editorNode.label}
      </div>

      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--ff-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {renderNodeSummary(editorNode)}
      </div>

      {/* Outgoing Source Handles */}
      {editorNode.type === "condition" ? (
        <div
          style={{
            marginTop: "0.6rem",
            paddingTop: "0.45rem",
            borderTop: "1px solid var(--ff-border)",
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              position: "relative",
              paddingRight: "0.4rem"
            }}
          >
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#4ade80" }}>
              TRUE
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              style={{
                top: "50%",
                width: "11px",
                height: "11px",
                backgroundColor: "#22c55e",
                border: "2px solid var(--ff-bg-surface)"
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              position: "relative",
              paddingRight: "0.4rem"
            }}
          >
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f87171" }}>
              FALSE
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              style={{
                top: "50%",
                width: "11px",
                height: "11px",
                backgroundColor: "#ef4444",
                border: "2px solid var(--ff-bg-surface)"
              }}
            />
          </div>
        </div>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="default"
          style={{
            width: "11px",
            height: "11px",
            backgroundColor: "var(--ff-accent)",
            border: "2px solid var(--ff-bg-surface)"
          }}
        />
      )}
    </div>
  );
}
