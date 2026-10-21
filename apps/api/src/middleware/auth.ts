import type { Request, Response, NextFunction } from "express";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifySessionToken,
  verifyCsrfToken,
  type SessionPayload
} from "../security/session.js";
import type { SessionRepository } from "../repositories/types.js";
import type { AppConfig } from "../config.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionPayload;
    }
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createAuthMiddleware(
  config: AppConfig,
  sessionRepo: SessionRepository
) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;

    if (!token) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required"
        }
      });
      return;
    }

    const session = await verifySessionToken(token, config.SESSION_SECRET);
    if (!session) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or expired session"
        }
      });
      return;
    }

    // Verify server-side session record is active and not revoked
    try {
      const persistedSession = await sessionRepo.findActiveByJti(session.jti);
      if (!persistedSession || persistedSession.userId !== session.sub) {
        res.status(401).json({
          error: {
            code: "UNAUTHORIZED",
            message: "Session has been revoked or expired"
          }
        });
        return;
      }
    } catch {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to verify session state"
        }
      });
      return;
    }

    // Enforce CSRF token validation on all state-changing requests
    if (MUTATING_METHODS.has(req.method.toUpperCase())) {
      const csrfHeader = req.header(CSRF_HEADER_NAME);
      const csrfCookie = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;

      const isCsrfValid = verifyCsrfToken(
        csrfHeader,
        csrfCookie,
        session.jti,
        config.CSRF_SECRET
      );

      if (!isCsrfValid) {
        res.status(403).json({
          error: {
            code: "CSRF_INVALID",
            message: "Invalid or missing CSRF token"
          }
        });
        return;
      }
    }

    req.auth = session;
    next();
  };
}
