import { prisma } from "@flowforge/database";
import { loadConfig } from "./config.js";
import {
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaWorkflowRepository,
  PrismaExecutionRepository
} from "./repositories/prisma-repositories.js";
import {
  InMemoryUserRepository,
  InMemorySessionRepository,
  InMemoryWorkflowRepository,
  InMemoryExecutionRepository
} from "./repositories/memory-repositories.js";
import { WorkflowRunProcessor } from "./services/execution-orchestrator.js";
import type {
  UserRepository,
  SessionRepository,
  WorkflowRepository,
  ExecutionRepository
} from "./repositories/types.js";
import { createApp } from "./app.js";
import { createApiShutdownHandler } from "./shutdown.js";

const config = loadConfig();

let userRepo: UserRepository;
let sessionRepo: SessionRepository;
let workflowRepo: WorkflowRepository;
let executionRepo: ExecutionRepository;
let onRunQueued: ((runId: string) => void) | undefined;

if (process.env.API_REPOSITORY_DRIVER === "memory") {
  userRepo = new InMemoryUserRepository();
  sessionRepo = new InMemorySessionRepository();
  const memWf = new InMemoryWorkflowRepository();
  workflowRepo = memWf;
  const memExec = new InMemoryExecutionRepository(memWf);
  executionRepo = memExec;
  const processor = new WorkflowRunProcessor(memExec, {
    workerId: "in_memory_worker"
  });
  onRunQueued = (runId: string) => {
    void processor.processRun(runId);
  };
} else {
  userRepo = new PrismaUserRepository();
  sessionRepo = new PrismaSessionRepository();
  workflowRepo = new PrismaWorkflowRepository();
  executionRepo = new PrismaExecutionRepository();
}

const app = createApp({
  config,
  userRepo,
  sessionRepo,
  workflowRepo,
  executionRepo,
  onRunQueued
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
    prismaClient:
      process.env.API_REPOSITORY_DRIVER === "memory" ? undefined : prisma,
    deadlineMs: 10_000
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

export { app, createApiShutdownHandler };

