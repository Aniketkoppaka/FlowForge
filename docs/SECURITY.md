# Security Model & Threat Controls (`docs/SECURITY.md`)

## 1. Authentication, Sessions & CSRF

- **Password Hashing**: Passwords are hashed using **Argon2id** (`@node-rs/argon2`) and never logged or returned in API responses.
- **Session Lifecycle & Revocation**:
  - Sessions use `HS256` signed JWTs stored in an `HttpOnly`, `SameSite=Lax` (`Secure` in production) cookie (`ff_session`) with a unique `jti`.
  - Every session is persisted in the PostgreSQL `Session` table (`jti`, `userId`, `expiresAt`, `revokedAt`).
  - Every authenticated request verifies both the cryptographic JWT signature and that the `Session` record is active (`revokedAt IS NULL` and `expiresAt > now()`).
  - `POST /api/auth/logout` sets `revokedAt = now()` in PostgreSQL so replaying a logged-out cookie immediately fails with `401 UNAUTHORIZED`.
- **CSRF Protection**:
  - State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require an `X-CSRF-Token` header matching the `ff_csrf` cookie and verified via constant-time HMAC-SHA256 against the user's session `jti`.
- **CORS & Rate Limiting**:
  - Wildcard `*` origins are rejected by startup config validation (`apps/api/src/config.ts`). Only explicit origins in `CORS_ORIGIN` are allowed.
  - Registration and login endpoints are protected by `express-rate-limit`.

---

## 2. Authorization & Ownership Isolation

- Every workflow, version, run, node execution, and cancellation query is scoped by `userId = req.auth.sub`.
- Unauthorized or cross-user lookups return a non-disclosing `404 NOT_FOUND` response so attackers cannot enumerate UUIDs belonging to other users.

---

## 3. SSRF-Hardened Outbound HTTP Client (`packages/workflow-engine/src/http-client.ts`)

1. **Fail-Closed Default**: Outbound HTTP execution is disabled (`NODE_NOT_SUPPORTED`) unless `ENABLE_OUTBOUND_HTTP="true"` is explicitly configured.
2. **URL Syntax & Encoding Validation (`validateTargetUrlSyntax`)**:
   - Permits only `http:` and `https:`.
   - Rejects embedded URL credentials (`user:pass@host`).
   - Blocks internal hostnames (`localhost`, `*.localhost`, `*.local`, `*.internal`, `metadata.google.internal`, `metadata`, `instance-data`).
   - Rejects decimal integer (`2130706433`), hexadecimal (`0x7f000001`), and octal (`0177.0.0.1`) IP encodings before WHATWG URL normalization.
3. **Comprehensive IP Blocklist (`isProhibitedIpAddress`)**:
   - Blocks IPv4 loopback (`127.0.0.0/8`), unspecified (`0.0.0.0/8`), RFC1918 private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local and cloud metadata (`169.254.0.0/16`, `100.100.100.200`), CGNAT (`100.64.0.0/10`), benchmarking/TEST-NET, and multicast/broadcast (`224.0.0.0/4+`).
   - Blocks IPv6 loopback (`::1`), unspecified (`::`), IPv4-mapped IPv6 (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`), Unique Local (`fc00::/7`, including `fd00:ec2::254`), link-local (`fe80::/10`), and multicast (`ff00::/8`).
4. **DNS Rebinding & Redirect Protection**:
   - Resolves all `A`/`AAAA` records and verifies **every** returned IP address. If a domain returns a mixed public + private DNS answer, the request is blocked (`SSRF_BLOCKED_IP`).
   - Pins the validated IP directly into Node's socket `lookup` callback so the TCP connection is guaranteed to connect to the exact IP that passed validation.
   - Blocks all `3xx` redirects fail-closed (`HTTP_REDIRECT_BLOCKED`).
5. **Resource Bounds & Secret Redaction**:
   - Enforces a `10,000 ms` timeout (`HTTP_TIMEOUT`) and `262,144` byte (`256 KB`) response body cap (`HTTP_RESPONSE_TOO_LARGE`).
   - Redacts `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token`, and `X-CSRF-Token` headers (`[REDACTED]`) before persisting execution outputs.
