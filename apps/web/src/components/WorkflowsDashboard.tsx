"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UserResponse, WorkflowResponse } from "@flowforge/contracts";
import { apiClient, ApiClientError } from "../lib/api";

export function WorkflowsDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<UserResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [workflows, setWorkflows] = useState<WorkflowResponse[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowDesc, setNewWorkflowDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const res = await apiClient.listWorkflows();
      setWorkflows(res.workflows);
    } catch (err) {
      setWorkflowsError(
        err instanceof Error ? err.message : "Failed to load workflows."
      );
    } finally {
      setWorkflowsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await apiClient.getMe();
        if (!mounted) return;
        setUser(me.user);
        await loadWorkflows();
      } catch {
        if (!mounted) return;
        setUser(null);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadWorkflows]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const res =
        authMode === "login"
          ? await apiClient.login({ email, password })
          : await apiClient.register({
              email,
              password,
              name: name.trim() || undefined
            });
      setUser(res.user);
      setPassword("");
      await loadWorkflows();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Authentication failed."
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiClient.logout();
      setUser(null);
      setWorkflows([]);
    } catch (err) {
      setWorkflowsError(
        err instanceof Error ? err.message : "Failed to log out."
      );
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newWorkflowName.trim();
    if (!trimmed) {
      setCreateError("Workflow name is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiClient.createWorkflow({
        name: trimmed,
        description: newWorkflowDesc.trim() || null,
        draftDefinition: {
          schemaVersion: 1,
          nodes: [],
          edges: []
        }
      });
      setNewWorkflowName("");
      setNewWorkflowDesc("");
      setWorkflows((prev) => [res.workflow, ...prev]);
      router.push(`/workflows/${res.workflow.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUser(null);
        return;
      }
      setCreateError(
        err instanceof Error ? err.message : "Failed to create workflow."
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteWorkflow = async (id: string, wfName: string) => {
    try {
      await apiClient.deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setWorkflowsError(
        err instanceof Error
          ? `Could not archive "${wfName}": ${err.message}`
          : "Failed to archive workflow."
      );
    }
  };

  if (authLoading) {
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
        Loading FlowForge workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            backgroundColor: "var(--ff-bg-surface)",
            border: "1px solid var(--ff-border-subtle)",
            borderRadius: "10px",
            padding: "2rem"
          }}
        >
          <div style={{ marginBottom: "1.5rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ff-accent)"
              }}
            >
              FlowForge Automation
            </span>
            <h1 style={{ fontSize: "1.5rem", margin: "0.35rem 0 0.25rem" }}>
              {authMode === "login" ? "Sign in to your workspace" : "Create your developer account"}
            </h1>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--ff-text-secondary)" }}>
              Construct and persist visual workflow graphs.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid var(--ff-danger)",
                color: "#fca5a5",
                padding: "0.75rem",
                borderRadius: "6px",
                fontSize: "0.875rem",
                marginBottom: "1rem"
              }}
            >
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit}>
            {authMode === "register" && (
              <div style={{ marginBottom: "1rem" }}>
                <label
                  htmlFor="auth-name"
                  style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}
                >
                  Display Name (optional)
                </label>
                <input
                  id="auth-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.6rem 0.75rem",
                    backgroundColor: "var(--ff-bg-input)",
                    border: "1px solid var(--ff-border-subtle)",
                    borderRadius: "6px",
                    color: "var(--ff-text-primary)"
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <label
                htmlFor="auth-email"
                style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}
              >
                Email Address
              </label>
              <input
                id="auth-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.6rem 0.75rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)"
                }}
              />
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="auth-password"
                style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}
              >
                Password
              </label>
              <span
                id="auth-password-hint"
                style={{ display: "block", fontSize: "0.75rem", color: "var(--ff-text-muted)", marginBottom: "0.35rem" }}
              >
                Minimum 8 characters.
              </span>
              <input
                id="auth-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                aria-describedby="auth-password-hint"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.6rem 0.75rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              style={{
                width: "100%",
                padding: "0.65rem 1rem",
                backgroundColor: "var(--ff-accent)",
                color: "#090d16",
                fontWeight: 700,
                border: "none",
                borderRadius: "6px",
                cursor: authSubmitting ? "wait" : "pointer"
              }}
            >
              {authSubmitting
                ? "Please wait..."
                : authMode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </button>
          </form>

          <div style={{ marginTop: "1rem", textAlign: "center" }}>
            <button
              type="button"
              onClick={() => {
                setAuthMode((m) => (m === "login" ? "register" : "login"));
                setAuthError(null);
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--ff-accent)",
                fontSize: "0.85rem",
                cursor: "pointer",
                textDecoration: "underline"
              }}
            >
              {authMode === "login"
                ? "Need an account? Register"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: "60px",
          backgroundColor: "var(--ff-bg-surface)",
          borderBottom: "1px solid var(--ff-border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1.5rem"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              display: "inline-block",
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: "var(--ff-accent)"
            }}
          />
          <strong style={{ fontSize: "1.1rem", letterSpacing: "-0.02em" }}>
            FlowForge
          </strong>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.15rem 0.5rem",
              backgroundColor: "var(--ff-bg-elevated)",
              borderRadius: "4px",
              color: "var(--ff-text-secondary)"
            }}
          >
            Workflows
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--ff-text-secondary)" }}>
            {user.email}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: "0.4rem 0.75rem",
              backgroundColor: "transparent",
              border: "1px solid var(--ff-border-subtle)",
              borderRadius: "6px",
              color: "var(--ff-text-primary)",
              fontSize: "0.8rem",
              cursor: "pointer"
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: "1040px", width: "100%", margin: "2rem auto", padding: "0 1.5rem" }}>
        <section
          aria-labelledby="create-workflow-heading"
          style={{
            backgroundColor: "var(--ff-bg-surface)",
            border: "1px solid var(--ff-border-subtle)",
            borderRadius: "10px",
            padding: "1.5rem",
            marginBottom: "2rem"
          }}
        >
          <h2 id="create-workflow-heading" style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Create New Workflow
          </h2>
          {createError && (
            <div
              role="alert"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid var(--ff-danger)",
                color: "#fca5a5",
                padding: "0.6rem 0.85rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                marginBottom: "1rem"
              }}
            >
              {createError}
            </div>
          )}
          <form
            onSubmit={handleCreateWorkflow}
            style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}
          >
            <div style={{ flex: "1 1 240px" }}>
              <label
                htmlFor="new-wf-name"
                style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}
              >
                Workflow Name *
              </label>
              <input
                id="new-wf-name"
                name="name"
                type="text"
                required
                placeholder="e.g. Stripe Order Enrichment"
                value={newWorkflowName}
                onChange={(e) => setNewWorkflowName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.55rem 0.75rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)"
                }}
              />
            </div>

            <div style={{ flex: "2 1 300px" }}>
              <label
                htmlFor="new-wf-desc"
                style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}
              >
                Description (optional)
              </label>
              <input
                id="new-wf-desc"
                name="description"
                type="text"
                placeholder="Brief summary of this automation pipeline"
                value={newWorkflowDesc}
                onChange={(e) => setNewWorkflowDesc(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.55rem 0.75rem",
                  backgroundColor: "var(--ff-bg-input)",
                  border: "1px solid var(--ff-border-subtle)",
                  borderRadius: "6px",
                  color: "var(--ff-text-primary)"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              style={{
                padding: "0.6rem 1.2rem",
                backgroundColor: "var(--ff-accent)",
                color: "#090d16",
                fontWeight: 700,
                border: "none",
                borderRadius: "6px",
                cursor: creating ? "wait" : "pointer"
              }}
            >
              {creating ? "Creating..." : "Create & Open Editor"}
            </button>
          </form>
        </section>

        <section aria-labelledby="workflows-list-heading">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 id="workflows-list-heading" style={{ margin: 0, fontSize: "1.15rem" }}>
              Your Workflows ({workflows.length})
            </h2>
          </div>

          {workflowsError && (
            <div
              role="alert"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid var(--ff-danger)",
                color: "#fca5a5",
                padding: "0.75rem",
                borderRadius: "6px",
                marginBottom: "1rem"
              }}
            >
              {workflowsError}
            </div>
          )}

          {workflowsLoading ? (
            <p style={{ color: "var(--ff-text-secondary)" }}>Loading workflows...</p>
          ) : workflows.length === 0 ? (
            <div
              style={{
                backgroundColor: "var(--ff-bg-surface)",
                border: "1px dashed var(--ff-border-subtle)",
                borderRadius: "10px",
                padding: "3rem 1.5rem",
                textAlign: "center",
                color: "var(--ff-text-secondary)"
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "1rem", color: "var(--ff-text-primary)" }}>
                No workflows created yet
              </p>
              <p style={{ margin: 0, fontSize: "0.875rem" }}>
                Use the form above to create your first visual automation workflow.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {workflows.map((wf) => {
                const draftObj = wf.draftDefinition as { nodes?: unknown[]; edges?: unknown[] } | null;
                const nodeCount = Array.isArray(draftObj?.nodes) ? draftObj.nodes.length : 0;
                const edgeCount = Array.isArray(draftObj?.edges) ? draftObj.edges.length : 0;

                return (
                  <div
                    key={wf.id}
                    style={{
                      backgroundColor: "var(--ff-bg-surface)",
                      border: "1px solid var(--ff-border-subtle)",
                      borderRadius: "8px",
                      padding: "1rem 1.25rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "1rem"
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <Link
                          href={`/workflows/${wf.id}`}
                          style={{
                            color: "var(--ff-text-primary)",
                            fontWeight: 700,
                            fontSize: "1rem",
                            textDecoration: "none"
                          }}
                        >
                          {wf.name}
                        </Link>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.1rem 0.45rem",
                            backgroundColor: "var(--ff-bg-elevated)",
                            borderRadius: "4px",
                            color: "var(--ff-text-secondary)"
                          }}
                        >
                          {nodeCount} {nodeCount === 1 ? "node" : "nodes"} · {edgeCount}{" "}
                          {edgeCount === 1 ? "edge" : "edges"}
                        </span>
                      </div>
                      {wf.description && (
                        <p
                          style={{
                            margin: "0.35rem 0 0",
                            fontSize: "0.85rem",
                            color: "var(--ff-text-secondary)"
                          }}
                        >
                          {wf.description}
                        </p>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Link
                        href={`/workflows/${wf.id}`}
                        style={{
                          padding: "0.45rem 0.85rem",
                          backgroundColor: "var(--ff-bg-elevated)",
                          border: "1px solid var(--ff-border-subtle)",
                          borderRadius: "6px",
                          color: "var(--ff-accent)",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          textDecoration: "none"
                        }}
                      >
                        Open Editor
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeleteWorkflow(wf.id, wf.name)}
                        aria-label={`Archive ${wf.name}`}
                        style={{
                          padding: "0.45rem 0.7rem",
                          backgroundColor: "transparent",
                          border: "1px solid var(--ff-border-subtle)",
                          borderRadius: "6px",
                          color: "var(--ff-text-muted)",
                          fontSize: "0.8rem",
                          cursor: "pointer"
                        }}
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
