import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
  CreateWorkflowRunRequestSchema,
  validateWorkflowExecutionReadiness,
  canonicalizeExecutableGraph
} from "@flowforge/contracts";
import type {
  WorkflowRepository,
  SessionRepository,
  ExecutionRepository,
  WorkflowRecord,
  WorkflowVersionRecord,
  WorkflowRunRecord,
  NodeExecutionRecordEntity
} from "../repositories/types.js";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";

const UuidParamSchema = z.string().uuid("Invalid UUID parameter format");

function serializeWorkflow(wf: WorkflowRecord) {
  return {
    id: wf.id,
    userId: wf.userId,
    name: wf.name,
    description: wf.description,
    draftDefinition: wf.draftDefinition,
    publishedVersionId: wf.publishedVersionId,
    publishedVersionNumber: wf.publishedVersionNumber,
    createdAt: wf.createdAt.toISOString(),
    updatedAt: wf.updatedAt.toISOString()
  };
}

function serializeWorkflowVersion(ver: WorkflowVersionRecord) {
  return {
    id: ver.id,
    workflowId: ver.workflowId,
    versionNumber: ver.versionNumber,
    contentHash: ver.contentHash,
    definition: ver.definition,
    createdAt: ver.createdAt.toISOString()
  };
}

export function serializeNodeExecution(ne: NodeExecutionRecordEntity) {
  return {
    id: ne.id,
    runId: ne.runId,
    nodeId: ne.nodeId,
    nodeType: ne.nodeType,
    label: ne.label,
    status: ne.status,
    attemptCount: ne.attemptCount,
    startedAt: ne.startedAt ? ne.startedAt.toISOString() : null,
    completedAt: ne.completedAt ? ne.completedAt.toISOString() : null,
    durationMs: ne.durationMs,
    input: ne.input,
    output: ne.output,
    selectedBranch: ne.selectedBranch,
    skipReason: ne.skipReason,
    error: ne.error
  };
}

export function serializeWorkflowRun(
  run: WorkflowRunRecord,
  nodeExecutions?: NodeExecutionRecordEntity[]
) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowVersionId: run.workflowVersionId,
    versionNumber: run.versionNumber,
    userId: run.userId,
    status: run.status,
    triggerPayload: run.triggerPayload,
    idempotencyKey: run.idempotencyKey,
    attemptCount: run.attemptCount,
    maxAttempts: run.maxAttempts,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    cancelledAt: run.cancelledAt ? run.cancelledAt.toISOString() : null,
    durationMs: run.durationMs,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    ...(nodeExecutions
      ? { nodeExecutions: nodeExecutions.map(serializeNodeExecution) }
      : {})
  };
}

export interface WorkflowRouterOptions {
  runRateLimit?: {
    windowMs?: number;
    max?: number;
  };
}

export function createWorkflowRouter(
  workflowRepo: WorkflowRepository,
  sessionRepo: SessionRepository,
  config: AppConfig,
  executionRepo?: ExecutionRepository,
  onRunQueued?: (runId: string) => void,
  options?: WorkflowRouterOptions
): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(config, sessionRepo);

  router.use(requireAuth);

  const runLimiter = rateLimit({
    windowMs: options?.runRateLimit?.windowMs ?? config.RUN_RATE_LIMIT_WINDOW_MS ?? 60_000,
    limit: options?.runRateLimit?.max ?? config.RUN_RATE_LIMIT_MAX ?? 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return req.auth?.sub ?? req.ip ?? "anonymous";
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many workflow run requests. Please try again later."
        }
      });
    }
  });

  // POST /api/workflows
  router.post("/", async (req: Request, res: Response) => {
    const parsed = CreateWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow creation payload",
          details: parsed.error.flatten().fieldErrors
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const created = await workflowRepo.create({
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        draftDefinition: parsed.data.draftDefinition
      });

      res.status(201).json({
        workflow: serializeWorkflow(created)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to create workflow"
        }
      });
    }
  });

  // GET /api/workflows
  router.get("/", async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.sub;
      const workflows = await workflowRepo.findActiveByUserId(userId);

      res.status(200).json({
        workflows: workflows.map(serializeWorkflow)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch workflows"
        }
      });
    }
  });

  // GET /api/workflows/:id
  router.get("/:id", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const workflow = await workflowRepo.findActiveByIdAndUserId(
        paramParsed.data,
        userId
      );

      // Enforce ownership & soft-delete hiding: return 404 whether nonexistent or owned by another user
      if (!workflow) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      res.status(200).json({
        workflow: serializeWorkflow(workflow)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve workflow"
        }
      });
    }
  });

  // PATCH /api/workflows/:id
  router.patch("/:id", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    const bodyParsed = UpdateWorkflowRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow update payload",
          details: bodyParsed.error.flatten()
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const updated = await workflowRepo.updateActiveByIdAndUserId(
        paramParsed.data,
        userId,
        bodyParsed.data
      );

      if (!updated) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      res.status(200).json({
        workflow: serializeWorkflow(updated)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to update workflow"
        }
      });
    }
  });

  // DELETE /api/workflows/:id
  router.delete("/:id", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const deleted = await workflowRepo.softDeleteByIdAndUserId(
        paramParsed.data,
        userId
      );

      if (!deleted) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      res.status(204).send();
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to delete workflow"
        }
      });
    }
  });

  // POST /api/workflows/:id/publish — Publishes an immutable WorkflowVersion from the validated draft
  router.post("/:id/publish", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const workflow = await workflowRepo.findActiveByIdAndUserId(
        paramParsed.data,
        userId
      );

      if (!workflow) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      const readiness = validateWorkflowExecutionReadiness(
        workflow.draftDefinition
      );
      if (!readiness.ready) {
        res.status(400).json({
          error: {
            code: "PUBLISH_VALIDATION_ERROR",
            message: readiness.errors.map((e) => e.message).join(" "),
            details: readiness.errors
          }
        });
        return;
      }

      const canonicalJson = canonicalizeExecutableGraph(readiness.graph);
      const contentHash = createHash("sha256").update(canonicalJson).digest("hex");
      const canonicalDefinition = JSON.parse(canonicalJson);

      const pubResult = await workflowRepo.publishVersion({
        workflowId: workflow.id,
        userId,
        contentHash,
        definition: canonicalDefinition
      });

      if (!pubResult) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      res.status(pubResult.alreadyPublished ? 200 : 201).json({
        workflow: serializeWorkflow(pubResult.workflow),
        version: serializeWorkflowVersion(pubResult.version),
        alreadyPublished: pubResult.alreadyPublished
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to publish workflow version"
        }
      });
    }
  });

  // GET /api/workflows/:id/versions — Lists immutable published versions for a workflow
  router.get("/:id/versions", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const workflow = await workflowRepo.findActiveByIdAndUserId(
        paramParsed.data,
        userId
      );
      if (!workflow) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      const versions = await workflowRepo.listVersionsByWorkflowIdAndUserId(
        workflow.id,
        userId
      );

      res.status(200).json({
        versions: versions.map(serializeWorkflowVersion)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch workflow versions"
        }
      });
    }
  });

  // POST /api/workflows/:id/runs — Enqueues an asynchronous execution run against a published version
  router.post("/:id/runs", runLimiter, async (req: Request, res: Response) => {
    if (!executionRepo) {
      res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Execution service is not configured"
        }
      });
      return;
    }

    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    const bodyParsed = CreateWorkflowRunRequestSchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow run request payload",
          details: bodyParsed.error.flatten().fieldErrors
        }
      });
      return;
    }

    const headerIdemKey = req.header("X-Idempotency-Key")?.trim();
    const idempotencyKey =
      bodyParsed.data.idempotencyKey ?? headerIdemKey ?? null;

    try {
      const userId = req.auth!.sub;
      const workflow = await workflowRepo.findActiveByIdAndUserId(
        paramParsed.data,
        userId
      );
      if (!workflow) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      const targetVersionId =
        bodyParsed.data.versionId ?? workflow.publishedVersionId;
      if (!targetVersionId) {
        res.status(400).json({
          error: {
            code: "WORKFLOW_NOT_PUBLISHED",
            message:
              "Workflow must be published before it can be executed. Publish a version first."
          }
        });
        return;
      }

      const version = await workflowRepo.findVersionById(
        workflow.id,
        targetVersionId
      );
      if (!version) {
        res.status(404).json({
          error: {
            code: "VERSION_NOT_FOUND",
            message: "Specified workflow version was not found"
          }
        });
        return;
      }

      const readiness = validateWorkflowExecutionReadiness(version.definition);
      if (!readiness.ready) {
        res.status(400).json({
          error: {
            code: "INVALID_PUBLISHED_VERSION",
            message: "Pinned workflow version failed execution readiness check",
            details: readiness.errors
          }
        });
        return;
      }

      const initialNodes = readiness.graph.topologicalOrder.map((nodeId) => {
        const node = readiness.graph.nodes.find((n) => n.id === nodeId)!;
        return {
          nodeId: node.id,
          nodeType: node.type,
          label: node.label
        };
      });

      const created = await executionRepo.createRunWithOutbox({
        workflowId: workflow.id,
        workflowVersionId: version.id,
        versionNumber: version.versionNumber,
        userId,
        triggerPayload: bodyParsed.data.triggerPayload,
        idempotencyKey,
        initialNodes
      });

      if (created.idempotencyConflict) {
        res.status(409).json({
          error: {
            code: "IDEMPOTENCY_KEY_CONFLICT",
            message:
              "Idempotency key was already used with a different version or trigger payload."
          }
        });
        return;
      }

      if (!created.reusedIdempotentRun && onRunQueued) {
        onRunQueued(created.run.id);
      }

      res.status(created.reusedIdempotentRun ? 200 : 202).json({
        run: serializeWorkflowRun(created.run),
        reusedIdempotentRun: created.reusedIdempotentRun
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to queue workflow run"
        }
      });
    }
  });

  // GET /api/workflows/:id/runs — Lists execution runs for a workflow with bounded pagination
  router.get("/:id/runs", async (req: Request, res: Response) => {
    if (!executionRepo) {
      res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Execution service is not configured"
        }
      });
      return;
    }

    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid workflow ID"
        }
      });
      return;
    }

    const rawLimit = Number(req.query.limit ?? 20);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(1, Math.trunc(rawLimit)), 100)
      : 20;
    const offset = Number.isFinite(rawOffset)
      ? Math.max(0, Math.trunc(rawOffset))
      : 0;

    try {
      const userId = req.auth!.sub;
      const workflow = await workflowRepo.findActiveByIdAndUserId(
        paramParsed.data,
        userId
      );
      if (!workflow) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow not found"
          }
        });
        return;
      }

      const result = await executionRepo.listRunsByWorkflowIdAndUserId(
        workflow.id,
        userId,
        { limit, offset }
      );

      res.status(200).json({
        runs: result.runs.map((r) => serializeWorkflowRun(r)),
        pagination: {
          total: result.total,
          limit,
          offset
        }
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch workflow runs"
        }
      });
    }
  });

  return router;
}
