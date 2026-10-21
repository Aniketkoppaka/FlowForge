import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { AppConfig } from "./config.js";
import type {
  UserRepository,
  SessionRepository,
  WorkflowRepository
} from "./repositories/types.js";
import { createAuthRouter } from "./routes/auth.js";
import { createWorkflowRouter } from "./routes/workflows.js";

export interface AppDependencies {
  config: AppConfig;
  userRepo: UserRepository;
  sessionRepo: SessionRepository;
  workflowRepo: WorkflowRepository;
}

export function createApp({
  config,
  userRepo,
  sessionRepo,
  workflowRepo
}: AppDependencies): Express {
  const app = express();

  const allowedOrigins = new Set(
    config.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0 && o !== "*")
  );

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        if (!requestOrigin) {
          callback(null, false);
          return;
        }
        if (allowedOrigins.has(requestOrigin)) {
          callback(null, requestOrigin);
          return;
        }
        callback(null, false);
      },
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
  app.use("/api/auth", createAuthRouter(userRepo, sessionRepo, config));
  app.use("/api/workflows", createWorkflowRouter(workflowRepo, sessionRepo, config));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Requested endpoint does not exist"
      }
    });
  });

  // Global error handler (handles malformed JSON bodies, payload too large, etc.)
  app.use(
    (
      err: Error & { status?: number; type?: string },
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      if (err.type === "entity.too.large" || err.status === 413) {
        res.status(413).json({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request payload exceeds the maximum allowed size"
          }
        });
        return;
      }

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
    }
  );

  return app;
}
