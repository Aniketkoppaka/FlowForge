import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type {
  ExecutionRepository,
  SessionRepository
} from "../repositories/types.js";
import type { AppConfig } from "../config.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import {
  serializeWorkflowRun,
  serializeNodeExecution
} from "./workflows.js";

const UuidParamSchema = z.string().uuid("Invalid run ID format");

export function createRunRouter(
  executionRepo: ExecutionRepository,
  sessionRepo: SessionRepository,
  config: AppConfig
): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(config, sessionRepo);

  router.use(requireAuth);

  // GET /api/runs/:id — Retrieves a run's status and node-level execution records (ownership-scoped)
  router.get("/:id", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid run ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const found = await executionRepo.findRunByIdAndUserId(
        paramParsed.data,
        userId
      );

      // Non-disclosing 404 whether nonexistent or owned by another user
      if (!found) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow run not found"
          }
        });
        return;
      }

      res.status(200).json({
        run: serializeWorkflowRun(found.run, found.nodeExecutions)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve workflow run"
        }
      });
    }
  });

  // GET /api/runs/:id/nodes — Retrieves node-level execution details for a run
  router.get("/:id/nodes", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid run ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const found = await executionRepo.findRunByIdAndUserId(
        paramParsed.data,
        userId
      );

      if (!found) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow run not found"
          }
        });
        return;
      }

      res.status(200).json({
        runId: found.run.id,
        status: found.run.status,
        nodeExecutions: found.nodeExecutions.map(serializeNodeExecution)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve node execution details"
        }
      });
    }
  });

  // POST /api/runs/:id/cancel — Requests safe cancellation of a QUEUED or RUNNING run
  router.post("/:id/cancel", async (req: Request, res: Response) => {
    const paramParsed = UuidParamSchema.safeParse(req.params.id);
    if (!paramParsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid run ID"
        }
      });
      return;
    }

    try {
      const userId = req.auth!.sub;
      const cancelled = await executionRepo.cancelRunByIdAndUserId(
        paramParsed.data,
        userId
      );

      if (!cancelled) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Workflow run not found"
          }
        });
        return;
      }

      res.status(200).json({
        run: serializeWorkflowRun(cancelled)
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to cancel workflow run"
        }
      });
    }
  });

  return router;
}
