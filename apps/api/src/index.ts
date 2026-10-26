import { prisma } from "@flowforge/database";
import { loadConfig } from "./config.js";
import {
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaWorkflowRepository,
  PrismaExecutionRepository
} from "./repositories/prisma-repositories.js";
import { createApp } from "./app.js";
import { createApiShutdownHandler } from "./shutdown.js";

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

  const shutdown = createApiShutdownHandler({
    server,
    prismaClient: prisma,
    deadlineMs: 10_000
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

export { app, createApiShutdownHandler };

