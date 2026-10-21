import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "@flowforge/database";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaWorkflowRepository,
  PrismaExecutionRepository
} from "./repositories/prisma-repositories.js";
import {
  OutboxDispatcher,
  WorkflowRunProcessor
} from "./services/execution-orchestrator.js";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME
} from "./security/session.js";

function extractCookies(setCookieHeader: string[] | string | undefined): {
  cookieHeader: string;
  csrfToken: string;
} {
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];

  let sessionPart = "";
  let csrfPart = "";
  let csrfValue = "";

  for (const item of list) {
    const firstSegment = item.split(";")[0] ?? "";
    if (firstSegment.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      sessionPart = firstSegment;
    } else if (firstSegment.startsWith(`${CSRF_COOKIE_NAME}=`)) {
      csrfPart = firstSegment;
      csrfValue = firstSegment.slice(`${CSRF_COOKIE_NAME}=`.length);
    }
  }

  return {
    cookieHeader: [sessionPart, csrfPart].filter(Boolean).join("; "),
    csrfToken: csrfValue
  };
}

/**
 * Real PostgreSQL + Prisma Integration Test Suite.
 * Runs when RUN_DB_INTEGRATION_TESTS="true" (automatically enabled in CI and local DB test runs).
 * Protects against accidental execution against non-test databases by verifying database name/URL.
 */
const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!shouldRunIntegration)(
  "@flowforge/api — Real PostgreSQL & Prisma Integration Suite",
  () => {
    const testConfig = loadConfig({
      NODE_ENV: "test",
      API_PORT: "4000",
      CORS_ORIGIN: "http://localhost:3000",
      SESSION_SECRET: "integration-test-session-secret-min-32-chars-long",
      CSRF_SECRET: "integration-test-csrf-secret-min-32-chars-long-key"
    });

    const userRepo = new PrismaUserRepository();
    const sessionRepo = new PrismaSessionRepository();
    const workflowRepo = new PrismaWorkflowRepository();
    const executionRepo = new PrismaExecutionRepository();
    const app = createApp({
      config: testConfig,
      userRepo,
      sessionRepo,
      workflowRepo,
      executionRepo
    });

    beforeAll(async () => {
      const dbUrl = process.env.DATABASE_URL ?? "";
      if (!dbUrl.includes("flowforge")) {
        throw new Error(
          "Safety check failed: DATABASE_URL does not appear to be a FlowForge test/dev database."
        );
      }
      await prisma.$connect();
      // Clean test tables in FK order
      await prisma.outboxEvent.deleteMany({});
      await prisma.executionAttempt.deleteMany({});
      await prisma.nodeExecution.deleteMany({});
      await prisma.workflowRun.deleteMany({});
      await prisma.workflow.updateMany({ data: { publishedVersionId: null } });
      await prisma.workflowVersion.deleteMany({});
      await prisma.workflow.deleteMany({});
      await prisma.session.deleteMany({});
      await prisma.user.deleteMany({});
    });

    afterAll(async () => {
      await prisma.outboxEvent.deleteMany({});
      await prisma.executionAttempt.deleteMany({});
      await prisma.nodeExecution.deleteMany({});
      await prisma.workflowRun.deleteMany({});
      await prisma.workflow.updateMany({ data: { publishedVersionId: null } });
      await prisma.workflowVersion.deleteMany({});
      await prisma.workflow.deleteMany({});
      await prisma.session.deleteMany({});
      await prisma.user.deleteMany({});
      await prisma.$disconnect();
    });

    it("persists users, sessions, and revokes sessions in PostgreSQL upon logout", async () => {
      const regRes = await request(app).post("/api/auth/register").send({
        email: "pg-user@example.com",
        password: "PostgresPassword123!",
        name: "PG User"
      });
      expect(regRes.status).toBe(201);

      const { cookieHeader, csrfToken } = extractCookies(regRes.headers["set-cookie"]);

      // Verify user and session rows exist in PostgreSQL
      const dbUser = await prisma.user.findUnique({ where: { email: "pg-user@example.com" } });
      expect(dbUser).not.toBeNull();

      const activeSessions = await prisma.session.findMany({
        where: { userId: dbUser!.id, revokedAt: null }
      });
      expect(activeSessions).toHaveLength(1);

      // Duplicate registration hits PostgreSQL unique constraint and returns 409
      const dupRes = await request(app).post("/api/auth/register").send({
        email: "pg-user@example.com",
        password: "AnotherPassword123!"
      });
      expect(dupRes.status).toBe(409);

      // Logout revokes the session row in PostgreSQL
      const logoutRes = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookieHeader)
        .set(CSRF_HEADER_NAME, csrfToken);
      expect(logoutRes.status).toBe(200);

      const revokedSession = await prisma.session.findUnique({
        where: { id: activeSessions[0]!.id }
      });
      expect(revokedSession?.revokedAt).not.toBeNull();

      // Replaying old cookie fails with 401
      const replayRes = await request(app).get("/api/auth/me").set("Cookie", cookieHeader);
      expect(replayRes.status).toBe(401);
    });

    it("persists workflows, enforces ownership isolation, soft-deletes in PostgreSQL, and enforces Restrict FK", async () => {
      const regA = await request(app).post("/api/auth/register").send({
        email: "pg-owner@example.com",
        password: "PostgresPassword123!"
      });
      const regB = await request(app).post("/api/auth/register").send({
        email: "pg-other@example.com",
        password: "PostgresPassword123!"
      });

      const authA = extractCookies(regA.headers["set-cookie"]);
      const authB = extractCookies(regB.headers["set-cookie"]);

      const createRes = await request(app)
        .post("/api/workflows")
        .set("Cookie", authA.cookieHeader)
        .set(CSRF_HEADER_NAME, authA.csrfToken)
        .send({
          name: "PG Persisted Workflow",
          description: "Stored in Postgres JSONB",
          draftDefinition: {
            schemaVersion: 1,
            nodes: [{ id: "trigger_1", type: "manual_trigger" }],
            edges: []
          }
        });
      expect(createRes.status).toBe(201);
      const wfId = createRes.body.workflow.id;

      // User B cannot read or mutate User A's workflow
      expect(
        (await request(app).get(`/api/workflows/${wfId}`).set("Cookie", authB.cookieHeader)).status
      ).toBe(404);

      // Verify Restrict FK: attempting to delete User A directly in Prisma while workflow exists throws FK constraint error
      await expect(
        prisma.user.delete({ where: { id: regA.body.user.id } })
      ).rejects.toThrow();

      // Soft delete workflow via API
      const delRes = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set("Cookie", authA.cookieHeader)
        .set(CSRF_HEADER_NAME, authA.csrfToken);
      expect(delRes.status).toBe(204);

      // Row still exists in PostgreSQL with non-null deletedAt
      const rawDbWorkflow = await prisma.workflow.findUnique({ where: { id: wfId } });
      expect(rawDbWorkflow).not.toBeNull();
      expect(rawDbWorkflow?.deletedAt).not.toBeNull();
    });

    it("executes full publish -> transactional outbox -> worker claim -> PostgreSQL run & node execution persistence", async () => {
      const reg = await request(app).post("/api/auth/register").send({
        email: "pg-runner@example.com",
        password: "PostgresPassword123!"
      });
      const auth = extractCookies(reg.headers["set-cookie"]);

      const createRes = await request(app)
        .post("/api/workflows")
        .set("Cookie", auth.cookieHeader)
        .set(CSRF_HEADER_NAME, auth.csrfToken)
        .send({
          name: "PG Durable Execution Flow",
          draftDefinition: {
            schemaVersion: 1,
            nodes: [
              { id: "trig", type: "manual_trigger", label: "Trigger", position: { x: 0, y: 0 }, config: { description: "" } },
              {
                id: "trans",
                type: "data_transform",
                label: "Transform",
                position: { x: 200, y: 0 },
                config: { mappings: [{ id: "m1", sourcePath: "trigger.payload.msg", targetKey: "resultMsg" }] }
              }
            ],
            edges: [{ id: "e1", source: "trig", sourceHandle: "default", target: "trans", targetHandle: "default" }]
          }
        });
      const wfId = createRes.body.workflow.id;

      const pubRes = await request(app)
        .post(`/api/workflows/${wfId}/publish`)
        .set("Cookie", auth.cookieHeader)
        .set(CSRF_HEADER_NAME, auth.csrfToken);
      expect(pubRes.status).toBe(201);

      const runRes = await request(app)
        .post(`/api/workflows/${wfId}/runs`)
        .set("Cookie", auth.cookieHeader)
        .set(CSRF_HEADER_NAME, auth.csrfToken)
        .send({ triggerPayload: { msg: "hello-postgres" } });
      expect(runRes.status).toBe(202);
      const runId = runRes.body.run.id;

      const dispatcher = new OutboxDispatcher(
        executionRepo,
        { enqueueRunJob: async () => {} },
        { dispatcherId: "pg_disp" }
      );
      const dispBatch = await dispatcher.dispatchBatch();
      expect(dispBatch.delivered).toBe(1);

      const processor = new WorkflowRunProcessor(executionRepo, {
        workerId: "pg_worker"
      });
      const proc = await processor.processRun(runId);
      expect(proc.status).toBe("COMPLETED");

      const detailRes = await request(app)
        .get(`/api/runs/${runId}`)
        .set("Cookie", auth.cookieHeader);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.run.status).toBe("COMPLETED");
    });
  }
);
