import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema
} from "@flowforge/contracts";
import type { WorkflowRepository, WorkflowRecord } from "../repositories/types.js";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";

const UuidParamSchema = z.string().uuid("Invalid workflow ID format");

function serializeWorkflow(wf: WorkflowRecord) {
  return {
    id: wf.id,
    userId: wf.userId,
    name: wf.name,
    description: wf.description,
    draftDefinition: wf.draftDefinition,
    createdAt: wf.createdAt.toISOString(),
    updatedAt: wf.updatedAt.toISOString()
  };
}

export function createWorkflowRouter(
  workflowRepo: WorkflowRepository,
  config: AppConfig
): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(config);

  router.use(requireAuth);

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

  return router;
}
