"use client";

import React from "react";
import type { WorkflowNodeType } from "@flowforge/contracts";

export interface PaletteNodeMeta {
  type: WorkflowNodeType;
  title: string;
  tag: string;
  description: string;
  accentColor: string;
}

export const PALETTE_NODES: readonly PaletteNodeMeta[] = [
  {
    type: "manual_trigger",
    title: "Manual Trigger",
    tag: "TRIGGER",
    description: "Starts the workflow manually. At most one per workflow.",
    accentColor: "#4ade80"
  },
  {
    type: "http_request",
    title: "HTTP Request",
    tag: "ACTION",
    description: "Configures an outbound REST API call (GET, POST, PUT, PATCH, DELETE).",
    accentColor: "#38bdf8"
  },
  {
    type: "condition",
    title: "Condition Branch",
    tag: "LOGIC",
    description: "Routes execution along distinct TRUE or FALSE branches.",
    accentColor: "#fbbf24"
  },
  {
    type: "data_transform",
    title: "Data Transform",
    tag: "TRANSFORM",
    description: "Maps upstream source paths into structured output keys.",
    accentColor: "#c084fc"
  }
];

export function NodePalette({
  hasManualTrigger,
  onAddNode
}: {
  hasManualTrigger: boolean;
  onAddNode: (type: WorkflowNodeType) => void;
}) {
  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    nodeType: WorkflowNodeType
  ) => {
    event.dataTransfer.setData("application/flowforge-node-type", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="ff-palette-sidebar" aria-label="Node Palette">
      <div
        style={{
          padding: "1rem 1rem 0.75rem",
          borderBottom: "1px solid var(--ff-border)"
        }}
      >
        <h2 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700 }}>
          Node Palette
        </h2>
        <p
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.75rem",
            color: "var(--ff-text-secondary)"
          }}
        >
          Click to add to canvas or drag onto the workspace.
        </p>
      </div>

      <div style={{ padding: "0.85rem", display: "grid", gap: "0.65rem" }}>
        {PALETTE_NODES.map((item) => {
          const isDisabled =
            item.type === "manual_trigger" && hasManualTrigger;

          return (
            <div
              key={item.type}
              draggable={!isDisabled}
              onDragStart={(e) => {
                if (!isDisabled) handleDragStart(e, item.type);
              }}
              style={{
                backgroundColor: "var(--ff-bg-elevated)",
                border: "1px solid var(--ff-border-subtle)",
                borderRadius: "8px",
                padding: "0.75rem",
                opacity: isDisabled ? 0.55 : 1,
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: item.accentColor
                  }}
                >
                  {item.tag}
                </span>
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onAddNode(item.type)}
                  aria-label={`Add ${item.title} node`}
                  style={{
                    padding: "0.25rem 0.6rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    backgroundColor: isDisabled
                      ? "transparent"
                      : "var(--ff-bg-surface)",
                    color: isDisabled
                      ? "var(--ff-text-muted)"
                      : "var(--ff-accent)",
                    border: "1px solid var(--ff-border-subtle)",
                    borderRadius: "5px",
                    cursor: isDisabled ? "not-allowed" : "pointer"
                  }}
                >
                  {isDisabled ? "Limit 1" : "+ Add"}
                </button>
              </div>

              <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>
                {item.title}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--ff-text-secondary)",
                  lineHeight: 1.4
                }}
              >
                {item.description}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
