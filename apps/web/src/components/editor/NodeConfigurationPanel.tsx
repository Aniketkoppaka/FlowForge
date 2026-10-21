"use client";

import React from "react";
import type {
  EditorNode,
  HttpMethod,
  ConditionOperator,
  HttpHeaderPair,
  DataMappingRow
} from "@flowforge/contracts";
import { validateNodeConfigForEditor } from "@flowforge/contracts";

const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
];

const CONDITION_OPERATORS: readonly { value: ConditionOperator; label: string }[] = [
  { value: "equals", label: "Equals (==)" },
  { value: "not_equals", label: "Not Equals (!=)" },
  { value: "contains", label: "Contains" },
  { value: "exists", label: "Exists (Not Empty)" }
];

function createRowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function NodeConfigurationPanel({
  node,
  onUpdateNode,
  onDeleteNode,
  onClose
}: {
  node: EditorNode;
  onUpdateNode: (nodeId: string, updater: (current: EditorNode) => EditorNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  const validationErrors = validateNodeConfigForEditor(node);
  const errorMap = new Map<string, string>();
  for (const err of validationErrors) {
    errorMap.set(err.field, err.message);
  }

  const handleLabelChange = (newLabel: string) => {
    onUpdateNode(node.id, (curr) => ({
      ...curr,
      label: newLabel
    }));
  };

  return (
    <aside
      className="ff-config-sidebar"
      aria-label="Node Configuration Panel"
      data-testid="node-config-panel"
    >
      <div
        style={{
          padding: "1rem",
          borderBottom: "1px solid var(--ff-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--ff-accent)"
            }}
          >
            {node.type.replace("_", " ")}
          </span>
          <h2 style={{ margin: "0.15rem 0 0", fontSize: "0.95rem" }}>
            Configure Node
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close configuration panel"
          style={{
            padding: "0.3rem 0.6rem",
            backgroundColor: "transparent",
            border: "1px solid var(--ff-border-subtle)",
            borderRadius: "5px",
            color: "var(--ff-text-secondary)",
            fontSize: "0.75rem",
            cursor: "pointer"
          }}
        >
          Close
        </button>
      </div>

      <div style={{ padding: "1rem", display: "grid", gap: "1rem" }}>
        <div>
          <span style={{ fontSize: "0.72rem", color: "var(--ff-text-muted)" }}>
            Node ID: <code>{node.id}</code>
          </span>
        </div>

        {/* Common Label Field */}
        <div>
          <label
            htmlFor="node-label-input"
            style={{
              display: "block",
              fontSize: "0.8rem",
              fontWeight: 600,
              marginBottom: "0.3rem"
            }}
          >
            Node Label *
          </label>
          <input
            id="node-label-input"
            name="label"
            type="text"
            required
            value={node.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            aria-describedby={errorMap.has("label") ? "node-label-error" : undefined}
            style={{
              width: "100%",
              padding: "0.5rem 0.65rem",
              backgroundColor: "var(--ff-bg-input)",
              border: errorMap.has("label")
                ? "1px solid var(--ff-danger)"
                : "1px solid var(--ff-border-subtle)",
              borderRadius: "6px",
              color: "var(--ff-text-primary)",
              fontSize: "0.85rem"
            }}
          />
          {errorMap.has("label") && (
            <p
              id="node-label-error"
              role="alert"
              style={{
                margin: "0.3rem 0 0",
                fontSize: "0.75rem",
                color: "#fca5a5"
              }}
            >
              {errorMap.get("label")}
            </p>
          )}
        </div>

        {/* 1. Manual Trigger Fields */}
        {node.type === "manual_trigger" && (
          <div>
            <label
              htmlFor="manual-trigger-desc"
              style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 600,
                marginBottom: "0.3rem"
              }}
            >
              Description (optional)
            </label>
            <textarea
              id="manual-trigger-desc"
              name="description"
              rows={3}
              placeholder="Describe when or how this manual trigger is invoked..."
              value={node.config.description}
              onChange={(e) => {
                const description = e.target.value;
                onUpdateNode(node.id, (curr) =>
                  curr.type === "manual_trigger"
                    ? { ...curr, config: { ...curr.config, description } }
                    : curr
                );
              }}
              style={{
                width: "100%",
                padding: "0.5rem 0.65rem",
                backgroundColor: "var(--ff-bg-input)",
                border: "1px solid var(--ff-border-subtle)",
                borderRadius: "6px",
                color: "var(--ff-text-primary)",
                fontSize: "0.85rem",
                resize: "vertical"
              }}
            />
          </div>
        )}

        {/* 2. HTTP Request Fields */}
        {node.type === "http_request" && (
          <>
            <fieldset
              style={{
                border: "none",
                margin: 0,
                padding: 0
              }}
            >
              <legend
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  marginBottom: "0.4rem"
                }}
              >
                HTTP Method
              </legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {HTTP_METHODS.map((m) => (
                  <label
                    key={m}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      padding: "0.3rem 0.55rem",
                      backgroundColor:
                        node.config.method === m
                          ? "rgba(56, 189, 248, 0.16)"
                          : "var(--ff-bg-input)",
                      border:
                        node.config.method === m
                          ? "1px solid var(--ff-accent)"
                          : "1px solid var(--ff-border-subtle)",
                      borderRadius: "5px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <input
                      type="radio"
                      name="http-method"
                      value={m}
                      checked={node.config.method === m}
                      onChange={() =>
                        onUpdateNode(node.id, (curr) =>
                          curr.type === "http_request"
                            ? { ...curr, config: { ...curr.config, method: m } }
                            : curr
                        )
                      }
                      style={{ margin: 0 }}
                    />
                    {m}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="http-url-input"
                style={{
                  display: "block",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  marginBottom: "0.3rem"
                }}
              >
                Request URL *
              </label>
              <span
                id="http-url-hint"
                style={{
                  display: "block",
                  fontSize: "0.72rem",
                  color: "var(--ff-text-muted)",
                  marginBottom: "0.3rem"
                }}
              >
                Full HTTP/HTTPS endpoint URL.
              </span>
              <input
                id="http-url-input"
                name="url"
                type="url"
                placeholder="https://api.example.com/v1/orders"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={node.config.url}
                aria-describedby="http-url-hint"
                onChange={(e) => {
                  const url = e.target.value;
                  onUpdateNode(node.id, (curr) =>
                    curr.type === "http_request"
                      ? { ...curr, config: { ...curr.config, url } }
                      : curr
                  );
                }}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.65rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: errorMap.has("url")
                    ? "1px solid var(--ff-danger)"
                    : "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)",
                  fontSize: "0.85rem"
                }}
              />
              {errorMap.has("url") && (
                <p
                  role="alert"
                  style={{
                    margin: "0.3rem 0 0",
                    fontSize: "0.75rem",
                    color: "#fca5a5"
                  }}
                >
                  {errorMap.get("url")}
                </p>
              )}
            </div>

            {/* Editable Headers */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.4rem"
                }}
              >
                <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                  Headers ({node.config.headers.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextHeader: HttpHeaderPair = {
                      id: createRowId("hdr"),
                      key: "",
                      value: ""
                    };
                    onUpdateNode(node.id, (curr) =>
                      curr.type === "http_request"
                        ? {
                            ...curr,
                            config: {
                              ...curr.config,
                              headers: [...curr.config.headers, nextHeader]
                            }
                          }
                        : curr
                    );
                  }}
                  style={{
                    padding: "0.2rem 0.5rem",
                    fontSize: "0.72rem",
                    backgroundColor: "var(--ff-bg-elevated)",
                    border: "1px solid var(--ff-border-subtle)",
                    borderRadius: "4px",
                    color: "var(--ff-accent)",
                    cursor: "pointer"
                  }}
                >
                  + Add Header
                </button>
              </div>

              {node.config.headers.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ff-text-muted)" }}>
                  No custom headers configured.
                </p>
              ) : (
                <div style={{ display: "grid", gap: "0.45rem" }}>
                  {node.config.headers.map((h, idx) => (
                    <div key={h.id} style={{ display: "grid", gap: "0.25rem" }}>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          type="text"
                          aria-label={`Header ${idx + 1} key`}
                          placeholder="Header Name"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          value={h.key}
                          onChange={(e) => {
                            const key = e.target.value;
                            onUpdateNode(node.id, (curr) =>
                              curr.type === "http_request"
                                ? {
                                    ...curr,
                                    config: {
                                      ...curr.config,
                                      headers: curr.config.headers.map((item) =>
                                        item.id === h.id ? { ...item, key } : item
                                      )
                                    }
                                  }
                                : curr
                            );
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: "0.4rem 0.5rem",
                            backgroundColor: "var(--ff-bg-input)",
                            border: "1px solid var(--ff-border-subtle)",
                            borderRadius: "5px",
                            color: "var(--ff-text-primary)",
                            fontSize: "0.78rem"
                          }}
                        />
                        <input
                          type="text"
                          aria-label={`Header ${idx + 1} value`}
                          placeholder="Value"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          value={h.value}
                          onChange={(e) => {
                            const value = e.target.value;
                            onUpdateNode(node.id, (curr) =>
                              curr.type === "http_request"
                                ? {
                                    ...curr,
                                    config: {
                                      ...curr.config,
                                      headers: curr.config.headers.map((item) =>
                                        item.id === h.id ? { ...item, value } : item
                                      )
                                    }
                                  }
                                : curr
                            );
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: "0.4rem 0.5rem",
                            backgroundColor: "var(--ff-bg-input)",
                            border: "1px solid var(--ff-border-subtle)",
                            borderRadius: "5px",
                            color: "var(--ff-text-primary)",
                            fontSize: "0.78rem"
                          }}
                        />
                        <button
                          type="button"
                          aria-label={`Remove header ${idx + 1}`}
                          onClick={() =>
                            onUpdateNode(node.id, (curr) =>
                              curr.type === "http_request"
                                ? {
                                    ...curr,
                                    config: {
                                      ...curr.config,
                                      headers: curr.config.headers.filter(
                                        (item) => item.id !== h.id
                                      )
                                    }
                                  }
                                : curr
                            )
                          }
                          style={{
                            padding: "0 0.45rem",
                            backgroundColor: "transparent",
                            border: "1px solid var(--ff-border-subtle)",
                            borderRadius: "5px",
                            color: "var(--ff-text-muted)",
                            cursor: "pointer"
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      {errorMap.has(`header:${h.id}`) && (
                        <span style={{ fontSize: "0.72rem", color: "#fca5a5" }}>
                          {errorMap.get(`header:${h.id}`)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Optional Request Body */}
            <div>
              <label
                htmlFor="http-body-input"
                style={{
                  display: "block",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  marginBottom: "0.3rem"
                }}
              >
                Request Body (optional)
              </label>
              <textarea
                id="http-body-input"
                name="body"
                rows={4}
                placeholder='{"event": "order.created"}'
                spellCheck={false}
                value={node.config.body}
                onChange={(e) => {
                  const body = e.target.value;
                  onUpdateNode(node.id, (curr) =>
                    curr.type === "http_request"
                      ? { ...curr, config: { ...curr.config, body } }
                      : curr
                  );
                }}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.65rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  resize: "vertical"
                }}
              />
            </div>
          </>
        )}

        {/* 3. Condition Fields */}
        {node.type === "condition" && (
          <>
            <div>
              <label
                htmlFor="cond-left-input"
                style={{
                  display: "block",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  marginBottom: "0.3rem"
                }}
              >
                Left Operand (Source Path) *
              </label>
              <input
                id="cond-left-input"
                name="leftOperand"
                type="text"
                placeholder="nodes.http_1.output.status"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={node.config.leftOperand}
                onChange={(e) => {
                  const leftOperand = e.target.value;
                  onUpdateNode(node.id, (curr) =>
                    curr.type === "condition"
                      ? { ...curr, config: { ...curr.config, leftOperand } }
                      : curr
                  );
                }}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.65rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: errorMap.has("leftOperand")
                    ? "1px solid var(--ff-danger)"
                    : "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)",
                  fontSize: "0.85rem"
                }}
              />
              {errorMap.has("leftOperand") && (
                <p
                  role="alert"
                  style={{
                    margin: "0.3rem 0 0",
                    fontSize: "0.75rem",
                    color: "#fca5a5"
                  }}
                >
                  {errorMap.get("leftOperand")}
                </p>
              )}
            </div>

            <fieldset
              style={{
                border: "none",
                margin: 0,
                padding: 0
              }}
            >
              <legend
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  marginBottom: "0.4rem"
                }}
              >
                Comparison Operator
              </legend>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                {CONDITION_OPERATORS.map((op) => (
                  <label
                    key={op.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.45rem",
                      padding: "0.35rem 0.6rem",
                      backgroundColor:
                        node.config.operator === op.value
                          ? "rgba(245, 158, 11, 0.16)"
                          : "var(--ff-bg-input)",
                      border:
                        node.config.operator === op.value
                          ? "1px solid var(--ff-warning)"
                          : "1px solid var(--ff-border-subtle)",
                      borderRadius: "5px",
                      fontSize: "0.8rem",
                      cursor: "pointer"
                    }}
                  >
                    <input
                      type="radio"
                      name="condition-operator"
                      value={op.value}
                      checked={node.config.operator === op.value}
                      onChange={() =>
                        onUpdateNode(node.id, (curr) =>
                          curr.type === "condition"
                            ? {
                                ...curr,
                                config: { ...curr.config, operator: op.value }
                              }
                            : curr
                        )
                      }
                    />
                    {op.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {node.config.operator !== "exists" && (
              <div>
                <label
                  htmlFor="cond-right-input"
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    marginBottom: "0.3rem"
                  }}
                >
                  Right Operand (Comparison Value) *
                </label>
                <input
                  id="cond-right-input"
                  name="rightOperand"
                  type="text"
                  placeholder="200"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={node.config.rightOperand}
                  onChange={(e) => {
                    const rightOperand = e.target.value;
                    onUpdateNode(node.id, (curr) =>
                      curr.type === "condition"
                        ? { ...curr, config: { ...curr.config, rightOperand } }
                        : curr
                    );
                  }}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.65rem",
                    backgroundColor: "var(--ff-bg-input)",
                    border: errorMap.has("rightOperand")
                      ? "1px solid var(--ff-danger)"
                      : "1px solid var(--ff-border-subtle)",
                    borderRadius: "6px",
                    color: "var(--ff-text-primary)",
                    fontSize: "0.85rem"
                  }}
                />
                {errorMap.has("rightOperand") && (
                  <p
                    role="alert"
                    style={{
                      margin: "0.3rem 0 0",
                      fontSize: "0.75rem",
                      color: "#fca5a5"
                    }}
                  >
                    {errorMap.get("rightOperand")}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* 4. Data Transform Fields */}
        {node.type === "data_transform" && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.4rem"
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                Field Mappings ({node.config.mappings.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextRow: DataMappingRow = {
                    id: createRowId("map"),
                    sourcePath: "",
                    targetKey: ""
                  };
                  onUpdateNode(node.id, (curr) =>
                    curr.type === "data_transform"
                      ? {
                          ...curr,
                          config: {
                            ...curr.config,
                            mappings: [...curr.config.mappings, nextRow]
                          }
                        }
                      : curr
                  );
                }}
                style={{
                  padding: "0.2rem 0.5rem",
                  fontSize: "0.72rem",
                  backgroundColor: "var(--ff-bg-elevated)",
                  border: "1px solid var(--ff-border-subtle)",
                  borderRadius: "4px",
                  color: "var(--ff-accent)",
                  cursor: "pointer"
                }}
              >
                + Add Mapping Row
              </button>
            </div>

            {node.config.mappings.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--ff-text-muted)" }}>
                No field mappings configured yet. Click &ldquo;+ Add Mapping Row&rdquo; above.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {node.config.mappings.map((row, idx) => (
                  <div
                    key={row.id}
                    style={{
                      padding: "0.55rem",
                      backgroundColor: "var(--ff-bg-elevated)",
                      borderRadius: "6px",
                      border: "1px solid var(--ff-border-subtle)",
                      display: "grid",
                      gap: "0.35rem"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <span style={{ fontSize: "0.7rem", color: "var(--ff-text-secondary)" }}>
                        Mapping #{idx + 1}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove mapping ${idx + 1}`}
                        onClick={() =>
                          onUpdateNode(node.id, (curr) =>
                            curr.type === "data_transform"
                              ? {
                                  ...curr,
                                  config: {
                                    ...curr.config,
                                    mappings: curr.config.mappings.filter(
                                      (m) => m.id !== row.id
                                    )
                                  }
                                }
                              : curr
                          )
                        }
                        style={{
                          padding: "0.1rem 0.4rem",
                          fontSize: "0.7rem",
                          backgroundColor: "transparent",
                          border: "1px solid var(--ff-border-subtle)",
                          borderRadius: "4px",
                          color: "var(--ff-text-muted)",
                          cursor: "pointer"
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <input
                      type="text"
                      aria-label={`Mapping ${idx + 1} source path`}
                      placeholder="Source path (e.g. nodes.http_1.data.email)"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={row.sourcePath}
                      onChange={(e) => {
                        const sourcePath = e.target.value;
                        onUpdateNode(node.id, (curr) =>
                          curr.type === "data_transform"
                            ? {
                                ...curr,
                                config: {
                                  ...curr.config,
                                  mappings: curr.config.mappings.map((m) =>
                                    m.id === row.id ? { ...m, sourcePath } : m
                                  )
                                }
                              }
                            : curr
                        );
                      }}
                      style={{
                        width: "100%",
                        padding: "0.4rem 0.5rem",
                        backgroundColor: "var(--ff-bg-input)",
                        border: "1px solid var(--ff-border-subtle)",
                        borderRadius: "5px",
                        color: "var(--ff-text-primary)",
                        fontSize: "0.78rem"
                      }}
                    />

                    <input
                      type="text"
                      aria-label={`Mapping ${idx + 1} output key`}
                      placeholder="Output key (e.g. customerEmail)"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      value={row.targetKey}
                      onChange={(e) => {
                        const targetKey = e.target.value;
                        onUpdateNode(node.id, (curr) =>
                          curr.type === "data_transform"
                            ? {
                                ...curr,
                                config: {
                                  ...curr.config,
                                  mappings: curr.config.mappings.map((m) =>
                                    m.id === row.id ? { ...m, targetKey } : m
                                  )
                                }
                              }
                            : curr
                        );
                      }}
                      style={{
                        width: "100%",
                        padding: "0.4rem 0.5rem",
                        backgroundColor: "var(--ff-bg-input)",
                        border: "1px solid var(--ff-border-subtle)",
                        borderRadius: "5px",
                        color: "var(--ff-text-primary)",
                        fontSize: "0.78rem"
                      }}
                    />

                    {errorMap.has(`mapping:${row.id}`) && (
                      <span style={{ fontSize: "0.72rem", color: "#fca5a5" }}>
                        {errorMap.get(`mapping:${row.id}`)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete Node Action */}
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--ff-border)"
          }}
        >
          <button
            type="button"
            onClick={() => onDeleteNode(node.id)}
            style={{
              width: "100%",
              padding: "0.55rem 0.75rem",
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              border: "1px solid var(--ff-danger)",
              borderRadius: "6px",
              color: "#fca5a5",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Delete Node
          </button>
        </div>
      </div>
    </aside>
  );
}
