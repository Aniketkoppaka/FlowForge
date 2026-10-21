import { SignJWT, jwtVerify } from "jose";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "ff_session";
export const CSRF_COOKIE_NAME = "ff_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface SessionPayload {
  sub: string; // userId
  email: string;
  jti: string; // unique session identifier
}

export async function createSessionToken(
  payload: { userId: string; email: string },
  secret: string,
  expiresInSeconds = SESSION_TTL_SECONDS
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = randomBytes(16).toString("hex");
  const secretKey = new TextEncoder().encode(secret);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const token = await new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setJti(jti)
    .setIssuedAt()
    .setIssuer("flowforge:api")
    .setAudience("flowforge:client")
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey);

  return { token, jti, expiresAt };
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: "flowforge:api",
      audience: "flowforge:client",
      algorithms: ["HS256"]
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      jti: payload.jti
    };
  } catch {
    return null;
  }
}

/**
 * Generates an HMAC-bound CSRF token tied to the session's unique jti.
 */
export function generateCsrfToken(jti: string, csrfSecret: string): string {
  return createHmac("sha256", csrfSecret).update(jti).digest("hex");
}

/**
 * Verifies CSRF token in constant time against expected session jti HMAC.
 */
export function verifyCsrfToken(
  providedToken: string | undefined,
  cookieToken: string | undefined,
  jti: string,
  csrfSecret: string
): boolean {
  if (!providedToken || !cookieToken) {
    return false;
  }

  const expectedToken = generateCsrfToken(jti, csrfSecret);
  const providedBuf = Buffer.from(providedToken, "utf8");
  const cookieBuf = Buffer.from(cookieToken, "utf8");
  const expectedBuf = Buffer.from(expectedToken, "utf8");

  if (
    providedBuf.length !== expectedBuf.length ||
    cookieBuf.length !== expectedBuf.length
  ) {
    return false;
  }

  return (
    timingSafeEqual(providedBuf, expectedBuf) &&
    timingSafeEqual(cookieBuf, expectedBuf)
  );
}
