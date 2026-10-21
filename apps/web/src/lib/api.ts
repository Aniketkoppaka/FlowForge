import type {
  UserResponse,
  WorkflowResponse,
  WorkflowVersionResponse,
  WorkflowRunResponse,
  NodeExecutionResponse,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  CreateWorkflowRunRequest
} from "@flowforge/contracts";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let cachedCsrfToken: string | null = null;

export function setClientCsrfToken(token: string | null) {
  cachedCsrfToken = token;
}

export function getClientCsrfToken(): string | null {
  if (cachedCsrfToken) return cachedCsrfToken;
  if (typeof document !== "undefined") {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith("ff_csrf="));
    if (match) {
      return decodeURIComponent(match.split("=")[1] ?? "");
    }
  }
  return null;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = getClientCsrfToken();
    if (csrf) {
      headers.set("X-CSRF-Token", csrf);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include"
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errObj = (data as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiClientError(
      response.status,
      errObj?.code ?? "API_ERROR",
      errObj?.message ?? `Request failed with status ${response.status}`,
      errObj?.details
    );
  }

  return data as T;
}

export const apiClient = {
  async getMe(): Promise<{ user: UserResponse; csrfToken: string }> {
    const res = await apiRequest<{ user: UserResponse; csrfToken: string }>(
      "/api/auth/me"
    );
    setClientCsrfToken(res.csrfToken);
    return res;
  },

  async login(payload: {
    email: string;
    password: string;
  }): Promise<{ user: UserResponse; csrfToken: string }> {
    const res = await apiRequest<{ user: UserResponse; csrfToken: string }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
    setClientCsrfToken(res.csrfToken);
    return res;
  },

  async register(payload: {
    email: string;
    password: string;
    name?: string;
  }): Promise<{ user: UserResponse; csrfToken: string }> {
    const res = await apiRequest<{ user: UserResponse; csrfToken: string }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
    setClientCsrfToken(res.csrfToken);
    return res;
  },

  async logout(): Promise<void> {
    await apiRequest<{ ok: boolean }>("/api/auth/logout", {
      method: "POST"
    });
    setClientCsrfToken(null);
  },

  async listWorkflows(): Promise<{ workflows: WorkflowResponse[] }> {
    return apiRequest<{ workflows: WorkflowResponse[] }>("/api/workflows");
  },

  async getWorkflow(id: string): Promise<{ workflow: WorkflowResponse }> {
    return apiRequest<{ workflow: WorkflowResponse }>(`/api/workflows/${encodeURIComponent(id)}`);
  },

  async createWorkflow(
    payload: CreateWorkflowRequest
  ): Promise<{ workflow: WorkflowResponse }> {
    return apiRequest<{ workflow: WorkflowResponse }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async updateWorkflow(
    id: string,
    payload: UpdateWorkflowRequest
  ): Promise<{ workflow: WorkflowResponse }> {
    return apiRequest<{ workflow: WorkflowResponse }>(
      `/api/workflows/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async deleteWorkflow(id: string): Promise<void> {
    return apiRequest<void>(`/api/workflows/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },

  async publishWorkflow(id: string): Promise<{
    workflow: WorkflowResponse;
    version: WorkflowVersionResponse;
    alreadyPublished: boolean;
  }> {
    return apiRequest<{
      workflow: WorkflowResponse;
      version: WorkflowVersionResponse;
      alreadyPublished: boolean;
    }>(`/api/workflows/${encodeURIComponent(id)}/publish`, {
      method: "POST"
    });
  },

  async listWorkflowVersions(
    id: string
  ): Promise<{ versions: WorkflowVersionResponse[] }> {
    return apiRequest<{ versions: WorkflowVersionResponse[] }>(
      `/api/workflows/${encodeURIComponent(id)}/versions`
    );
  },

  async createWorkflowRun(
    workflowId: string,
    payload: Partial<CreateWorkflowRunRequest> = {}
  ): Promise<{ run: WorkflowRunResponse; reusedIdempotentRun: boolean }> {
    return apiRequest<{
      run: WorkflowRunResponse;
      reusedIdempotentRun: boolean;
    }>(`/api/workflows/${encodeURIComponent(workflowId)}/runs`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async listWorkflowRuns(
    workflowId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{
    runs: WorkflowRunResponse[];
    pagination: { total: number; limit: number; offset: number };
  }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return apiRequest<{
      runs: WorkflowRunResponse[];
      pagination: { total: number; limit: number; offset: number };
    }>(`/api/workflows/${encodeURIComponent(workflowId)}/runs${qs}`);
  },

  async getWorkflowRun(runId: string): Promise<{ run: WorkflowRunResponse }> {
    return apiRequest<{ run: WorkflowRunResponse }>(
      `/api/runs/${encodeURIComponent(runId)}`
    );
  },

  async getRunNodeExecutions(runId: string): Promise<{
    runId: string;
    status: string;
    nodeExecutions: NodeExecutionResponse[];
  }> {
    return apiRequest<{
      runId: string;
      status: string;
      nodeExecutions: NodeExecutionResponse[];
    }>(`/api/runs/${encodeURIComponent(runId)}/nodes`);
  },

  async cancelWorkflowRun(
    runId: string
  ): Promise<{ run: WorkflowRunResponse }> {
    return apiRequest<{ run: WorkflowRunResponse }>(
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: "POST"
      }
    );
  }
};
