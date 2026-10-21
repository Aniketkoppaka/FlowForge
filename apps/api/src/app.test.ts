import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  InMemoryUserRepository,
  InMemoryWorkflowRepository
} from "./repositories/memory-repositories.js";
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

describe("@flowforge/api — Authentication & Workflow CRUD Suite", () => {
  let app: ReturnType<typeof createApp>;
  let userRepo: InMemoryUserRepository;
  let workflowRepo: InMemoryWorkflowRepository;

  const testConfig = loadConfig({
    NODE_ENV: "test",
    API_PORT: "4000",
    CORS_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-minimum-32-characters-long-key",
    CSRF_SECRET: "test-csrf-secret-minimum-32-characters-long-key-123"
  });

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();
    workflowRepo = new InMemoryWorkflowRepository();
    app = createApp({ config: testConfig, userRepo, workflowRepo });
  });

  describe("1. Authentication Lifecycle", () => {
    it("registers a new user, sets HttpOnly session + CSRF cookies, and returns user info", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "Alice@Example.com",
        password: "StrongPassword123!",
        name: "Alice"
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({
        email: "alice@example.com",
        name: "Alice"
      });
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(typeof res.body.csrfToken).toBe("string");

      const cookies = res.headers["set-cookie"] as unknown as string[];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && c.includes("HttpOnly"))).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))).toBe(true);
    });

    it("rejects duplicate account registration with 409 Conflict", async () => {
      await request(app).post("/api/auth/register").send({
        email: "bob@example.com",
        password: "StrongPassword123!"
      });

      const dupRes = await request(app).post("/api/auth/register").send({
        email: "BOB@example.com",
        password: "AnotherPassword123!"
      });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe("CONFLICT");
    });

    it("authenticates valid credentials on login and rejects invalid credentials with generic 401", async () => {
      await request(app).post("/api/auth/register").send({
        email: "carol@example.com",
        password: "CorrectHorseBatteryStaple1!"
      });

      // Wrong password
      const badPassRes = await request(app).post("/api/auth/login").send({
        email: "carol@example.com",
        password: "WrongPassword123!"
      });
      expect(badPassRes.status).toBe(401);
      expect(badPassRes.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(badPassRes.body.error.message).toBe("Invalid email or password");

      // Nonexistent account returns identical generic error
      const noUserRes = await request(app).post("/api/auth/login").send({
        email: "nonexistent@example.com",
        password: "WrongPassword123!"
      });
      expect(noUserRes.status).toBe(401);
      expect(noUserRes.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(noUserRes.body.error.message).toBe("Invalid email or password");

      // Valid login
      const okRes = await request(app).post("/api/auth/login").send({
        email: "carol@example.com",
        password: "CorrectHorseBatteryStaple1!"
      });
      expect(okRes.status).toBe(200);
      expect(okRes.body.user.email).toBe("carol@example.com");
    });

    it("supports /api/auth/me and clears cookies on /api/auth/logout", async () => {
      const regRes = await request(app).post("/api/auth/register").send({
        email: "dave@example.com",
        password: "StrongPassword123!"
      });

      const { cookieHeader, csrfToken } = extractCookies(regRes.headers["set-cookie"]);

      // GET /api/auth/me
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Cookie", cookieHeader);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe("dave@example.com");

      // POST /api/auth/logout without CSRF token -> rejected with 403
      const logoutNoCsrf = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookieHeader);
      expect(logoutNoCsrf.status).toBe(403);
      expect(logoutNoCsrf.body.error.code).toBe("CSRF_INVALID");

      // POST /api/auth/logout with valid CSRF token -> 200
      const logoutOk = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookieHeader)
        .set(CSRF_HEADER_NAME, csrfToken);
      expect(logoutOk.status).toBe(200);
      expect(logoutOk.body.ok).toBe(true);

      // Unauthenticated /api/auth/me -> 401
      const unauthMe = await request(app).get("/api/auth/me");
      expect(unauthMe.status).toBe(401);
    });

    it("enforces login rate limiting", async () => {
      // In test mode, limit is 10 requests per window
      for (let i = 0; i < 10; i++) {
        await request(app).post("/api/auth/login").send({
          email: "ratelimit@example.com",
          password: "wrongpassword123"
        });
      }

      const blockedRes = await request(app).post("/api/auth/login").send({
        email: "ratelimit@example.com",
        password: "wrongpassword123"
      });
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("2. Workflow CRUD, Draft Storage, Soft Deletion & Tenant Isolation", () => {
    async function registerAndGetAuth(email: string) {
      const res = await request(app).post("/api/auth/register").send({
        email,
        password: "Password123456!"
      });
      return {
        user: res.body.user,
        ...extractCookies(res.headers["set-cookie"])
      };
    }

    it("rejects unauthenticated access to all workflow endpoints", async () => {
      expect((await request(app).get("/api/workflows")).status).toBe(401);
      expect((await request(app).post("/api/workflows").send({ name: "Test" })).status).toBe(401);
      expect((await request(app).get("/api/workflows/00000000-0000-0000-0000-000000000000")).status).toBe(401);
      expect((await request(app).patch("/api/workflows/00000000-0000-0000-0000-000000000000").send({ name: "X" })).status).toBe(401);
      expect((await request(app).delete("/api/workflows/00000000-0000-0000-0000-000000000000")).status).toBe(401);
    });

    it("creates, lists, retrieves, and updates a workflow including intermediate draft JSON", async () => {
      const userA = await registerAndGetAuth("usera@example.com");

      // Create workflow with intermediate/incomplete draft graph
      const createRes = await request(app)
        .post("/api/workflows")
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken)
        .send({
          name: "Order Processing Flow",
          description: "Initial draft",
          draftDefinition: {
            schemaVersion: 1,
            nodes: [
              { id: "disconnected_node_1", type: "http_request", presentation: { position: { x: 100, y: 200 } } }
            ],
            edges: []
          }
        });

      expect(createRes.status).toBe(201);
      const wfId = createRes.body.workflow.id;
      expect(createRes.body.workflow.name).toBe("Order Processing Flow");
      expect(createRes.body.workflow.draftDefinition.nodes).toHaveLength(1);

      // List workflows
      const listRes = await request(app)
        .get("/api/workflows")
        .set("Cookie", userA.cookieHeader);
      expect(listRes.status).toBe(200);
      expect(listRes.body.workflows).toHaveLength(1);
      expect(listRes.body.workflows[0].id).toBe(wfId);

      // Get workflow by ID
      const getRes = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader);
      expect(getRes.status).toBe(200);
      expect(getRes.body.workflow.id).toBe(wfId);

      // Patch workflow name & draftDefinition
      const patchRes = await request(app)
        .patch(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken)
        .send({
          name: "Updated Order Flow",
          draftDefinition: {
            schemaVersion: 1,
            nodes: [
              { id: "n1", type: "manual_trigger" },
              { id: "n2", type: "condition" }
            ],
            edges: [{ id: "e1", source: "n1", target: "n2" }]
          }
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.workflow.name).toBe("Updated Order Flow");
      expect(patchRes.body.workflow.draftDefinition.nodes).toHaveLength(2);
    });

    it("enforces strict ownership isolation between User A and User B", async () => {
      const userA = await registerAndGetAuth("owner@example.com");
      const userB = await registerAndGetAuth("intruder@example.com");

      const createRes = await request(app)
        .post("/api/workflows")
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken)
        .send({ name: "Private Workflow" });

      const wfId = createRes.body.workflow.id;

      // User B listing workflows sees 0 workflows
      const bList = await request(app)
        .get("/api/workflows")
        .set("Cookie", userB.cookieHeader);
      expect(bList.status).toBe(200);
      expect(bList.body.workflows).toHaveLength(0);

      // User B reading User A's workflow by ID gets 404 (no resource leak)
      const bGet = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set("Cookie", userB.cookieHeader);
      expect(bGet.status).toBe(404);

      // User B updating User A's workflow gets 404
      const bPatch = await request(app)
        .patch(`/api/workflows/${wfId}`)
        .set("Cookie", userB.cookieHeader)
        .set(CSRF_HEADER_NAME, userB.csrfToken)
        .send({ name: "Hacked Name" });
      expect(bPatch.status).toBe(404);

      // User B deleting User A's workflow gets 404
      const bDelete = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set("Cookie", userB.cookieHeader)
        .set(CSRF_HEADER_NAME, userB.csrfToken);
      expect(bDelete.status).toBe(404);

      // Verify User A's workflow is untouched
      const aGet = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader);
      expect(aGet.status).toBe(200);
      expect(aGet.body.workflow.name).toBe("Private Workflow");
    });

    it("soft-deletes workflows and excludes archived records from listings and lookups", async () => {
      const userA = await registerAndGetAuth("softdelete@example.com");

      const createRes = await request(app)
        .post("/api/workflows")
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken)
        .send({ name: "To Be Archived" });

      const wfId = createRes.body.workflow.id;

      // Soft delete
      const delRes = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken);
      expect(delRes.status).toBe(204);

      // Excluded from active list
      const listRes = await request(app)
        .get("/api/workflows")
        .set("Cookie", userA.cookieHeader);
      expect(listRes.body.workflows).toHaveLength(0);

      // Excluded from GET by ID
      const getRes = await request(app)
        .get(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader);
      expect(getRes.status).toBe(404);

      // Cannot be patched or deleted a second time
      const patchRes = await request(app)
        .patch(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken)
        .send({ name: "Revive" });
      expect(patchRes.status).toBe(404);

      const delAgain = await request(app)
        .delete(`/api/workflows/${wfId}`)
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken);
      expect(delAgain.status).toBe(404);
    });

    it("rejects invalid payloads with 400 VALIDATION_ERROR", async () => {
      const userA = await registerAndGetAuth("validator@example.com");

      // Empty name
      const badCreate = await request(app)
        .post("/api/workflows")
        .set("Cookie", userA.cookieHeader)
        .set(CSRF_HEADER_NAME, userA.csrfToken)
        .send({ name: "   " });
      expect(badCreate.status).toBe(400);
      expect(badCreate.body.error.code).toBe("VALIDATION_ERROR");

      // Invalid UUID parameter
      const badUuid = await request(app)
        .get("/api/workflows/not-a-valid-uuid")
        .set("Cookie", userA.cookieHeader);
      expect(badUuid.status).toBe(400);
      expect(badUuid.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
