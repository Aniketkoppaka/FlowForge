import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { SignJWT } from "jose";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  InMemoryUserRepository,
  InMemorySessionRepository,
  InMemoryWorkflowRepository
} from "./repositories/memory-repositories.js";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createSessionToken
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

describe("@flowforge/api — Authentication, Session Revocation, Security & Workflow CRUD Suite", () => {
  let app: ReturnType<typeof createApp>;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
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
    sessionRepo = new InMemorySessionRepository();
    workflowRepo = new InMemoryWorkflowRepository();
    app = createApp({ config: testConfig, userRepo, sessionRepo, workflowRepo });
  });

  describe("1. Authentication & Server-Side Session Revocation Lifecycle", () => {
    it("registers a new user, persists a server-side session, sets HttpOnly session + CSRF cookies, and returns user info", async () => {
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
      expect(
        cookies.some(
          (c) =>
            c.startsWith(`${SESSION_COOKIE_NAME}=`) &&
            c.includes("HttpOnly") &&
            c.includes("SameSite=Lax") &&
            c.includes("Path=/")
        )
      ).toBe(true);
      expect(
        cookies.some(
          (c) =>
            c.startsWith(`${CSRF_COOKIE_NAME}=`) &&
            c.includes("SameSite=Lax") &&
            c.includes("Path=/")
        )
      ).toBe(true);
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

    it("revokes the server-side session on /api/auth/logout and rejects any replay of the old session cookie", async () => {
      const regRes = await request(app).post("/api/auth/register").send({
        email: "dave@example.com",
        password: "StrongPassword123!"
      });

      // Capture the original session & CSRF cookies before logout
      const { cookieHeader: capturedPreLogoutCookie, csrfToken: capturedCsrfToken } =
        extractCookies(regRes.headers["set-cookie"]);

      // Verify session works before logout
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Cookie", capturedPreLogoutCookie);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe("dave@example.com");

      // POST /api/auth/logout without CSRF token -> rejected with 403
      const logoutNoCsrf = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", capturedPreLogoutCookie);
      expect(logoutNoCsrf.status).toBe(403);
      expect(logoutNoCsrf.body.error.code).toBe("CSRF_INVALID");

      // POST /api/auth/logout with valid CSRF token -> 200 & revokes session server-side
      const logoutOk = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", capturedPreLogoutCookie)
        .set(CSRF_HEADER_NAME, capturedCsrfToken);
      expect(logoutOk.status).toBe(200);
      expect(logoutOk.body.ok).toBe(true);

      // CRITICAL REGRESSION TEST: Replay the captured pre-logout cookie against protected endpoints
      const replayMe = await request(app)
        .get("/api/auth/me")
        .set("Cookie", capturedPreLogoutCookie);
      expect(replayMe.status).toBe(401);
      expect(replayMe.body.error.code).toBe("UNAUTHORIZED");

      const replayListWorkflows = await request(app)
        .get("/api/workflows")
        .set("Cookie", capturedPreLogoutCookie);
      expect(replayListWorkflows.status).toBe(401);

      const replayCreateWorkflow = await request(app)
        .post("/api/workflows")
        .set("Cookie", capturedPreLogoutCookie)
        .set(CSRF_HEADER_NAME, capturedCsrfToken)
        .send({ name: "Should Fail After Logout" });
      expect(replayCreateWorkflow.status).toBe(401);

      const replayLogoutAgain = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", capturedPreLogoutCookie)
        .set(CSRF_HEADER_NAME, capturedCsrfToken);
      expect(replayLogoutAgain.status).toBe(401);
    });

    it("rejects forged, expired, or unpersisted JWTs and alg=none tokens", async () => {
      // 1. Validly signed JWT whose jti does not exist in SessionRepository
      const { token: unpersistedToken } = await createSessionToken(
        { userId: "00000000-0000-0000-0000-000000000001", email: "ghost@example.com" },
        testConfig.SESSION_SECRET
      );
      const resUnpersisted = await request(app)
        .get("/api/auth/me")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${unpersistedToken}`);
      expect(resUnpersisted.status).toBe(401);

      // 2. Expired JWT
      const { token: expiredToken, jti: expJti } = await createSessionToken(
        { userId: "00000000-0000-0000-0000-000000000001", email: "exp@example.com" },
        testConfig.SESSION_SECRET,
        -60 // expired 60s ago
      );
      await sessionRepo.create({
        jti: expJti,
        userId: "00000000-0000-0000-0000-000000000001",
        expiresAt: new Date(Date.now() - 60000)
      });
      const resExpired = await request(app)
        .get("/api/auth/me")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${expiredToken}`);
      expect(resExpired.status).toBe(401);

      // 3. JWT signed with wrong secret
      const wrongKey = new TextEncoder().encode("wrong-secret-key-that-is-at-least-32-bytes-long");
      const badSigToken = await new SignJWT({ email: "attacker@example.com" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("00000000-0000-0000-0000-000000000001")
        .setJti("fake-jti")
        .setIssuer("flowforge:api")
        .setAudience("flowforge:client")
        .setExpirationTime("2h")
        .sign(wrongKey);

      const resBadSig = await request(app)
        .get("/api/auth/me")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${badSigToken}`);
      expect(resBadSig.status).toBe(401);
    });

    it("enforces login rate limiting", async () => {
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

  describe("2. CSRF, CORS, and Production Secret Validation", () => {
    it("enforces CSRF protection across all state-changing workflow routes and rejects cross-session CSRF tokens", async () => {
      const regA = await request(app).post("/api/auth/register").send({
        email: "csrfa@example.com",
        password: "Password123456!"
      });
      const regB = await request(app).post("/api/auth/register").send({
        email: "csrfb@example.com",
        password: "Password123456!"
      });

      const authA = extractCookies(regA.headers["set-cookie"]);
      const authB = extractCookies(regB.headers["set-cookie"]);

      // Create workflow with User A's valid CSRF
      const createOk = await request(app)
        .post("/api/workflows")
        .set("Cookie", authA.cookieHeader)
        .set(CSRF_HEADER_NAME, authA.csrfToken)
        .send({ name: "CSRF Test Flow" });
      expect(createOk.status).toBe(201);
      const wfId = createOk.body.workflow.id;

      // Missing CSRF header on POST, PATCH, DELETE -> 403
      expect(
        (
          await request(app)
            .post("/api/workflows")
            .set("Cookie", authA.cookieHeader)
            .send({ name: "No CSRF" })
        ).status
      ).toBe(403);

      expect(
        (
          await request(app)
            .patch(`/api/workflows/${wfId}`)
            .set("Cookie", authA.cookieHeader)
            .send({ name: "No CSRF" })
        ).status
      ).toBe(403);

      expect(
        (
          await request(app)
            .delete(`/api/workflows/${wfId}`)
            .set("Cookie", authA.cookieHeader)
        ).status
      ).toBe(403);

      // Using User B's valid CSRF token with User A's session cookie -> 403
      const crossSessionCsrf = await request(app)
        .post("/api/workflows")
        .set("Cookie", `${SESSION_COOKIE_NAME}=${authA.cookieHeader.split(";")[0]?.split("=")[1]}; ${CSRF_COOKIE_NAME}=${authB.csrfToken}`)
        .set(CSRF_HEADER_NAME, authB.csrfToken)
        .send({ name: "Cross Session CSRF" });
      expect(crossSessionCsrf.status).toBe(403);
    });

    it("enforces explicit CORS origin allowlist and never reflects untrusted origins", async () => {
      // Trusted origin receives Access-Control-Allow-Origin
      const trustedRes = await request(app)
        .get("/api/health")
        .set("Origin", "http://localhost:3000");
      expect(trustedRes.status).toBe(200);
      expect(trustedRes.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(trustedRes.headers["access-control-allow-credentials"]).toBe("true");

      // Untrusted origin does NOT receive Access-Control-Allow-Origin
      const untrustedRes = await request(app)
        .get("/api/health")
        .set("Origin", "https://evil-attacker.example.com");
      expect(untrustedRes.status).toBe(200);
      expect(untrustedRes.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("fails fast in production if SESSION_SECRET or CSRF_SECRET is missing or too short, or if CORS_ORIGIN is wildcard", () => {
      expect(() =>
        loadConfig({
          NODE_ENV: "production"
        })
      ).toThrow(/Invalid environment configuration/);

      expect(() =>
        loadConfig({
          NODE_ENV: "production",
          SESSION_SECRET: "short",
          CSRF_SECRET: "short"
        })
      ).toThrow(/Invalid environment configuration/);

      expect(() =>
        loadConfig({
          NODE_ENV: "production",
          SESSION_SECRET: "prod-session-secret-at-least-32-chars-long-1234",
          CSRF_SECRET: "prod-csrf-secret-at-least-32-chars-long-1234567",
          CORS_ORIGIN: "*"
        })
      ).toThrow(/Invalid environment configuration/);
    });

    it("handles malformed JSON payloads cleanly without leaking stack traces", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send("{malformed-json:");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: "INVALID_JSON",
          message: "Malformed JSON payload"
        }
      });
    });
  });

  describe("3. Workflow CRUD, Draft Storage, Soft Deletion & Tenant Isolation", () => {
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
