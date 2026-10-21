import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { AppConfig } from "./config.js";
import type { UserRepository, WorkflowRepository } from "./repositories/types.js";
import { createAuthRouter } from "./routes/auth.js";
import { createWorkflowRouter } from "./routes/workflows.js";

export interface AppDependencies {
  config: AppConfig;
  userRepo: UserRepository;
  workflowRepo: WorkflowRepository;
}

export function createApp({ config, userRepo, workflowRepo }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token"]
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  // Healthcheck
  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", service: "@flowforge/api" });
  });

  // Mount API routes
  app.use("/api/auth", createAuthRouter(userRepo, config));
  app.use("/api/workflows", createWorkflowRouter(workflowRepo, config));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Requested endpoint does not exist"
      }
    });
  });

  // Global error handler (handles malformed JSON bodies, etc.)
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Malformed JSON payload"
        }
      });
      return;
    }

    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected internal server error occurred"
      }
    });
  });

  return app;
}
