import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  InMemoryUserRepository,
  InMemorySessionRepository,
  InMemoryWorkflowRepository,
  InMemoryExecutionRepository
} from "./repositories/memory-repositories.js";

describe("Workflow Run Rate Limiter (POST /api/workflows/:id/runs)", () => {
  const config = loadConfig({
    SESSION_SECRET: "01234567890123456789012345678901",
    CSRF_SECRET: "12345678901234567890123456789012",
    NODE_ENV: "test"
  });

  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let workflowRepo: InMemoryWorkflowRepository;
  let executionRepo: InMemoryExecutionRepository;

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();
    sessionRepo = new InMemorySessionRepository();
    workflowRepo = new InMemoryWorkflowRepository();
    executionRepo = new InMemoryExecutionRepository();
  });

  async function registerAndLogin(app: ReturnType<typeof createApp>, email: string) {
    const agent = request.agent(app);
    const regRes = await agent.post("/api/auth/register").send({
      email,
      password: "TestPassword123!"
    });
    expect(regRes.status).toBe(201);
    const csrfToken = regRes.body.csrfToken as string;
    const userId = regRes.body.user.id as string;
    return { agent, csrfToken, userId };
  }

  it("enforces per-user rate limit and returns 429 RATE_LIMIT_EXCEEDED when quota is exhausted", async () => {
    // Configure rate limit with a small limit for fast, deterministic testing: max 3 requests
    const app = createApp({
      config,
      userRepo,
      sessionRepo,
      workflowRepo,
      executionRepo,
      runRateLimit: {
        windowMs: 60_000,
        max: 3
      }
    });

    const user1 = await registerAndLogin(app, "user1@example.com");

    // Create a workflow and publish a version for user 1
    const wf = await workflowRepo.create({
      userId: user1.userId,
      name: "Rate Limit Test Workflow",
      draftDefinition: {
        nodes: [
          {
            id: "trigger_1",
            type: "manual_trigger",
            name: "Trigger",
            position: { x: 0, y: 0 },
            config: {}
          }
        ],
        edges: []
      }
    });

    const pubRes = await user1.agent
      .post(`/api/workflows/${wf.id}/publish`)
      .set("X-CSRF-Token", user1.csrfToken)
      .send();
    expect(pubRes.status).toBe(201);

    // Make 3 requests within quota
    for (let i = 0; i < 3; i++) {
      const res = await user1.agent
        .post(`/api/workflows/${wf.id}/runs`)
        .set("X-CSRF-Token", user1.csrfToken)
        .send({});
      expect(res.status).toBe(202);
      expect(res.body.run).toBeDefined();
    }

    // 4th request must be rate limited with HTTP 429
    const blockedRes = await user1.agent
      .post(`/api/workflows/${wf.id}/runs`)
      .set("X-CSRF-Token", user1.csrfToken)
      .send({});

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body).toEqual({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many workflow run requests. Please try again later."
      }
    });
  });

  it("isolates quotas per authenticated user identity", async () => {
    const app = createApp({
      config,
      userRepo,
      sessionRepo,
      workflowRepo,
      executionRepo,
      runRateLimit: {
        windowMs: 60_000,
        max: 2
      }
    });

    const user1 = await registerAndLogin(app, "u1@example.com");
    const user2 = await registerAndLogin(app, "u2@example.com");

    const wf1 = await workflowRepo.create({
      userId: user1.userId,
      name: "WF1",
      draftDefinition: {
        nodes: [
          {
            id: "t1",
            type: "manual_trigger",
            name: "Trigger",
            position: { x: 0, y: 0 },
            config: {}
          }
        ],
        edges: []
      }
    });
    await user1.agent
      .post(`/api/workflows/${wf1.id}/publish`)
      .set("X-CSRF-Token", user1.csrfToken)
      .send();

    const wf2 = await workflowRepo.create({
      userId: user2.userId,
      name: "WF2",
      draftDefinition: {
        nodes: [
          {
            id: "t1",
            type: "manual_trigger",
            name: "Trigger",
            position: { x: 0, y: 0 },
            config: {}
          }
        ],
        edges: []
      }
    });
    await user2.agent
      .post(`/api/workflows/${wf2.id}/publish`)
      .set("X-CSRF-Token", user2.csrfToken)
      .send();

    // User 1 exhausts their 2 requests
    for (let i = 0; i < 2; i++) {
      const res = await user1.agent
        .post(`/api/workflows/${wf1.id}/runs`)
        .set("X-CSRF-Token", user1.csrfToken)
        .send({});
      expect(res.status).toBe(202);
    }

    // User 1 is throttled
    const blockedUser1 = await user1.agent
      .post(`/api/workflows/${wf1.id}/runs`)
      .set("X-CSRF-Token", user1.csrfToken)
      .send({});
    expect(blockedUser1.status).toBe(429);

    // User 2 should NOT be throttled
    const user2Res = await user2.agent
      .post(`/api/workflows/${wf2.id}/runs`)
      .set("X-CSRF-Token", user2.csrfToken)
      .send({});
    expect(user2Res.status).toBe(202);
    expect(user2Res.body.run).toBeDefined();
  });

  it("unauthenticated requests fail with 401 before rate limiter is triggered", async () => {
    const app = createApp({
      config,
      userRepo,
      sessionRepo,
      workflowRepo,
      executionRepo,
      runRateLimit: {
        windowMs: 60_000,
        max: 1
      }
    });

    const res = await request(app)
      .post("/api/workflows/11111111-1111-4111-8111-111111111111/runs")
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("preserves tenant non-disclosure: attempts against other tenants' workflows return 404 without leaking existence", async () => {
    const app = createApp({
      config,
      userRepo,
      sessionRepo,
      workflowRepo,
      executionRepo,
      runRateLimit: {
        windowMs: 60_000,
        max: 5
      }
    });

    const victim = await registerAndLogin(app, "victim@example.com");
    const attacker = await registerAndLogin(app, "attacker@example.com");

    const victimWf = await workflowRepo.create({
      userId: victim.userId,
      name: "Victim Workflow",
      draftDefinition: {
        nodes: [
          {
            id: "t1",
            type: "manual_trigger",
            name: "Trigger",
            position: { x: 0, y: 0 },
            config: {}
          }
        ],
        edges: []
      }
    });
    await victim.agent
      .post(`/api/workflows/${victimWf.id}/publish`)
      .set("X-CSRF-Token", victim.csrfToken)
      .send();

    // Attacker tries to trigger victim's workflow
    const foreignRes = await attacker.agent
      .post(`/api/workflows/${victimWf.id}/runs`)
      .set("X-CSRF-Token", attacker.csrfToken)
      .send({});

    expect(foreignRes.status).toBe(404);
    expect(foreignRes.body.error.code).toBe("NOT_FOUND");
    expect(foreignRes.body.error.message).toBe("Workflow not found");
  });
});
