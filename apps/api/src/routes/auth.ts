import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { RegisterRequestSchema, LoginRequestSchema } from "@flowforge/contracts";
import type { UserRepository, UserRecord } from "../repositories/types.js";
import type { AppConfig } from "../config.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  createSessionToken,
  generateCsrfToken
} from "../security/session.js";
import { createAuthMiddleware } from "../middleware/auth.js";

function serializeUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function setAuthCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
  isProd: boolean
) {
  const maxAgeMs = 1000 * 60 * 60 * 8; // 8 hours

  res.cookie(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs
  });

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false, // readable by frontend JS to attach as X-CSRF-Token header
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs
  });
}

function clearAuthCookies(res: Response, isProd: boolean) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/"
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/"
  });
}

export function createAuthRouter(userRepo: UserRepository, config: AppConfig): Router {
  const router = Router();
  const isProd = config.NODE_ENV === "production";
  const requireAuth = createAuthMiddleware(config);

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: config.NODE_ENV === "test" ? 10 : 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts. Please try again later."
      }
    }
  });

  // POST /api/auth/register
  router.post("/register", authRateLimiter, async (req: Request, res: Response) => {
    const parsed = RegisterRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid registration payload",
          details: parsed.error.flatten().fieldErrors
        }
      });
      return;
    }

    const { email, password, name } = parsed.data;

    try {
      const existing = await userRepo.findByEmail(email);
      if (existing) {
        res.status(409).json({
          error: {
            code: "CONFLICT",
            message: "Unable to register account with provided credentials"
          }
        });
        return;
      }

      const passwordHash = await hashPassword(password);
      const user = await userRepo.create({
        email,
        name: name ?? null,
        passwordHash
      });

      const { token, jti } = await createSessionToken(
        { userId: user.id, email: user.email },
        config.SESSION_SECRET
      );
      const csrfToken = generateCsrfToken(jti, config.CSRF_SECRET);

      setAuthCookies(res, token, csrfToken, isProd);

      res.status(201).json({
        user: serializeUser(user),
        csrfToken
      });
    } catch (err: unknown) {
      const errorObj = err as { code?: string };
      if (errorObj?.code === "P2002") {
        res.status(409).json({
          error: {
            code: "CONFLICT",
            message: "Unable to register account with provided credentials"
          }
        });
        return;
      }
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred during registration"
        }
      });
    }
  });

  // POST /api/auth/login
  router.post("/login", authRateLimiter, async (req: Request, res: Response) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid login payload",
          details: parsed.error.flatten().fieldErrors
        }
      });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const user = await userRepo.findByEmail(email);
      if (!user) {
        res.status(401).json({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password"
          }
        });
        return;
      }

      const isValid = await verifyPassword(user.passwordHash, password);
      if (!isValid) {
        res.status(401).json({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password"
          }
        });
        return;
      }

      const { token, jti } = await createSessionToken(
        { userId: user.id, email: user.email },
        config.SESSION_SECRET
      );
      const csrfToken = generateCsrfToken(jti, config.CSRF_SECRET);

      setAuthCookies(res, token, csrfToken, isProd);

      res.status(200).json({
        user: serializeUser(user),
        csrfToken
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred during login"
        }
      });
    }
  });

  // POST /api/auth/logout
  router.post("/logout", requireAuth, (_req: Request, res: Response) => {
    clearAuthCookies(res, isProd);
    res.status(200).json({ ok: true });
  });

  // GET /api/auth/me
  router.get("/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.sub;
      const user = await userRepo.findById(userId);

      if (!user) {
        clearAuthCookies(res, isProd);
        res.status(401).json({
          error: {
            code: "UNAUTHORIZED",
            message: "Account no longer exists"
          }
        });
        return;
      }

      const csrfToken = generateCsrfToken(req.auth!.jti, config.CSRF_SECRET);
      res.status(200).json({
        user: serializeUser(user),
        csrfToken
      });
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred"
        }
      });
    }
  });

  return router;
}
