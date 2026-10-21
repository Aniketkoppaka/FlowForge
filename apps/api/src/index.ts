import { loadConfig } from "./config.js";
import {
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaWorkflowRepository,
  PrismaExecutionRepository
} from "./repositories/prisma-repositories.js";
import { createApp } from "./app.js";

const config = loadConfig();
const userRepo = new PrismaUserRepository();
const sessionRepo = new PrismaSessionRepository();
const workflowRepo = new PrismaWorkflowRepository();
const executionRepo = new PrismaExecutionRepository();

const app = createApp({
  config,
  userRepo,
  sessionRepo,
  workflowRepo,
  executionRepo
});

if (process.env.NODE_ENV !== "test") {
  const server = app.listen(config.API_PORT, () => {
    console.log(
      JSON.stringify({
        level: "info",
        service: "@flowforge/api",
        event: "server_started",
        port: config.API_PORT,
        timestamp: new Date().toISOString()
      })
    );
  });

  const shutdown = (signal: string) => {
    console.log(
      JSON.stringify({
        level: "info",
        service: "@flowforge/api",
        event: "graceful_shutdown_started",
        signal,
        timestamp: new Date().toISOString()
      })
    );
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export { app };
