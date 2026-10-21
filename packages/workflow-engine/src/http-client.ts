import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import type { LookupFunction } from "node:net";
import type { HttpMethod, HttpHeaderPair } from "@flowforge/contracts";

export const MAX_HTTP_RESPONSE_BYTES = 262_144; // 256 KB
export const MAX_HTTP_TIMEOUT_MS = 10_000; // 10 seconds
export const MAX_HTTP_REDIRECTS = 0; // Redirects disabled by default to prevent SSRF redirect bypass

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token"
]);

const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data"
]);

export type SsrfFailureCode =
  | "SSRF_BLOCKED_URL"
  | "SSRF_BLOCKED_IP"
  | "SSRF_DNS_FAILURE"
  | "HTTP_REDIRECT_BLOCKED"
  | "HTTP_TIMEOUT"
  | "HTTP_RESPONSE_TOO_LARGE"
  | "HTTP_NETWORK_ERROR";

export class SafeHttpError extends Error {
  readonly code: SsrfFailureCode;
  readonly details?: Record<string, unknown>;

  constructor(code: SsrfFailureCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SafeHttpError";
    this.code = code;
    this.details = details;
  }
}

export interface SafeHttpRequestOptions {
  method: HttpMethod;
  url: string;
  headers?: readonly HttpHeaderPair[];
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /**
   * Optional DNS resolver override for deterministic unit testing of DNS rebinding / mixed records.
   */
  resolveHostname?: (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;
  /**
   * Internal test-only socket address override so local ephemeral HTTP test servers (listening on
   * 127.0.0.1) can be used to test redirect blocking, response size caps, timeouts, and header
   * redaction without weakening production SSRF IP validation.
   */
  __testConnectAddress?: { address: string; family: 4 | 6 };
}

export interface SafeHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  rawBodyPreview: string;
  truncated: boolean;
  durationMs: number;
  redactedRequestHeaders: Record<string, string>;
}

/**
 * Determines whether an IPv4 or IPv6 literal falls into any prohibited range:
 * - Loopback (`127.0.0.0/8`, `::1`)
 * - Unspecified / Broadcast (`0.0.0.0/8`, `255.255.255.255`, `::`)
 * - RFC1918 Private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
 * - Link-Local & Cloud Metadata (`169.254.0.0/16`, `fe80::/10`, `100.100.100.200`, `fd00:ec2::254`)
 * - Carrier-Grade NAT (`100.64.0.0/10`)
 * - IETF / Documentation / Benchmarking (`192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`)
 * - Multicast / Reserved (`224.0.0.0/4`, `240.0.0.0/4`, `ff00::/8`)
 * - Unique Local IPv6 (`fc00::/7`)
 * - IPv4-mapped IPv6 (`::ffff:a.b.c.d`) evaluated against IPv4 rules
 */
export function isProhibitedIpAddress(ip: string): {
  prohibited: boolean;
  reason?: string;
} {
  const trimmed = ip.trim().toLowerCase();
  const family = net.isIP(trimmed);

  if (family === 0) {
    return { prohibited: true, reason: `Malformed IP address '${ip}'.` };
  }

  if (family === 4) {
    return checkIpv4(trimmed);
  }

  return checkIpv6(trimmed);
}

function checkIpv4(ip: string): { prohibited: boolean; reason?: string } {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return { prohibited: true, reason: `Invalid IPv4 octets in '${ip}'.` };
  }

  const [a, b, c, d] = parts as [number, number, number, number];

  if (a === 0) {
    return { prohibited: true, reason: "Unspecified IPv4 range 0.0.0.0/8 is prohibited." };
  }
  if (a === 127) {
    return { prohibited: true, reason: "Loopback IPv4 range 127.0.0.0/8 is prohibited." };
  }
  if (a === 10) {
    return { prohibited: true, reason: "Private RFC1918 range 10.0.0.0/8 is prohibited." };
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return { prohibited: true, reason: "Private RFC1918 range 172.16.0.0/12 is prohibited." };
  }
  if (a === 192 && b === 168) {
    return { prohibited: true, reason: "Private RFC1918 range 192.168.0.0/16 is prohibited." };
  }
  if (a === 169 && b === 254) {
    return {
      prohibited: true,
      reason: "Link-local and cloud metadata range 169.254.0.0/16 is prohibited."
    };
  }
  if (a === 100 && b === 100 && c === 100 && d === 200) {
    return { prohibited: true, reason: "Cloud metadata IP 100.100.100.200 is prohibited." };
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return { prohibited: true, reason: "Shared CGNAT range 100.64.0.0/10 is prohibited." };
  }
  if (a === 192 && b === 0 && (c === 0 || c === 2)) {
    return { prohibited: true, reason: "Reserved IETF/TEST-NET IPv4 range is prohibited." };
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return { prohibited: true, reason: "Benchmarking range 198.18.0.0/15 is prohibited." };
  }
  if (a === 198 && b === 51 && c === 100) {
    return { prohibited: true, reason: "TEST-NET-2 range 198.51.100.0/24 is prohibited." };
  }
  if (a === 203 && b === 0 && c === 113) {
    return { prohibited: true, reason: "TEST-NET-3 range 203.0.113.0/24 is prohibited." };
  }
  if (a >= 224) {
    return {
      prohibited: true,
      reason: "Multicast and reserved IPv4 range 224.0.0.0/4+ is prohibited."
    };
  }

  return { prohibited: false };
}

function checkIpv6(ip: string): { prohibited: boolean; reason?: string } {
  const normalized = ip.split("%")[0]!; // Strip zone index if any

  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") {
    return { prohibited: true, reason: "Unspecified IPv6 address :: is prohibited." };
  }
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return { prohibited: true, reason: "Loopback IPv6 address ::1 is prohibited." };
  }

  // Check IPv4-mapped IPv6 in dotted form (e.g. ::ffff:127.0.0.1)
  const v4MappedPrefix = "::ffff:";
  if (normalized.startsWith(v4MappedPrefix)) {
    const tail = normalized.slice(v4MappedPrefix.length);
    if (net.isIPv4(tail)) {
      return checkIpv4(tail);
    }
  }

  // Expand IPv6 into 8 16-bit hextets for accurate prefix checks
  const groups = expandIpv6(normalized);
  if (!groups) {
    return { prohibited: true, reason: `Malformed IPv6 address '${ip}'.` };
  }

  // Check IPv4-mapped IPv6 in hex form (0:0:0:0:0:ffff:wxyz:abcd)
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    (groups[5] === 0xffff || groups[5] === 0)
  ) {
    const high = groups[6]!;
    const low = groups[7]!;
    if (groups[5] === 0xffff || (high !== 0 || low > 1)) {
      const ipv4Str = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return checkIpv4(ipv4Str);
    }
  }

  const first = groups[0]!;
  // fc00::/7 (Unique Local Addresses, includes fd00:ec2::254 AWS metadata)
  if ((first & 0xfe00) === 0xfc00) {
    return { prohibited: true, reason: "Unique Local IPv6 range fc00::/7 is prohibited." };
  }
  // fe80::/10 (Link-Local)
  if ((first & 0xffc0) === 0xfe80) {
    return { prohibited: true, reason: "Link-local IPv6 range fe80::/10 is prohibited." };
  }
  // ff00::/8 (Multicast)
  if ((first & 0xff00) === 0xff00) {
    return { prohibited: true, reason: "Multicast IPv6 range ff00::/8 is prohibited." };
  }
  // 2001:db8::/32 (Documentation)
  if (first === 0x2001 && groups[1] === 0x0db8) {
    return { prohibited: true, reason: "Documentation IPv6 range 2001:db8::/32 is prohibited." };
  }

  return { prohibited: false };
}

function expandIpv6(ip: string): number[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const parseSegmentList = (part: string): number[] | null => {
    if (!part) return [];
    const tokens = part.split(":");
    const nums: number[] = [];
    for (const token of tokens) {
      if (token.includes(".")) {
        if (!net.isIPv4(token)) return null;
        const octets = token.split(".").map(Number);
        nums.push((octets[0]! << 8) | octets[1]!);
        nums.push((octets[2]! << 8) | octets[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        nums.push(parseInt(token, 16));
      }
    }
    return nums;
  };

  const left = parseSegmentList(parts[0]!);
  if (!left) return null;

  if (parts.length === 1) {
    return left.length === 8 ? left : null;
  }

  const right = parseSegmentList(parts[1]!);
  if (!right) return null;

  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;

  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/**
 * Validates a URL string for SSRF safety before DNS resolution:
 * - Only `http:` and `https:` protocols are permitted.
 * - Rejects embedded URL credentials (`username` or `password`).
 * - Rejects localhost/metadata hostnames, octal/hex/integer IPv4 encodings.
 */
export function validateTargetUrlSyntax(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SafeHttpError("SSRF_BLOCKED_URL", `Invalid request URL '${rawUrl}'.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SafeHttpError(
      "SSRF_BLOCKED_URL",
      `Unsupported URL protocol '${parsed.protocol}'. Only http: and https: are allowed.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new SafeHttpError(
      "SSRF_BLOCKED_URL",
      "Embedded credentials in URLs are prohibited."
    );
  }

  const rawHostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!rawHostname) {
    throw new SafeHttpError("SSRF_BLOCKED_URL", "URL hostname cannot be empty.");
  }

  if (
    FORBIDDEN_HOSTNAMES.has(rawHostname) ||
    rawHostname.endsWith(".localhost") ||
    rawHostname.endsWith(".internal") ||
    rawHostname.endsWith(".local")
  ) {
    throw new SafeHttpError(
      "SSRF_BLOCKED_URL",
      `Hostname '${rawHostname}' is prohibited by SSRF policy.`
    );
  }

  // Reject integer/hex/octal encoded IPv4 hostnames in the raw URL string BEFORE WHATWG URL normalization
  const rawHostMatch = rawUrl.trim().match(/^https?:\/\/([^/?#]+)/i);
  const preNormalizedHost = rawHostMatch?.[1]?.split("@").pop()?.split(":")[0]?.toLowerCase() ?? "";
  if (/^(0x[0-9a-f]+|\d+)$/i.test(preNormalizedHost)) {
    throw new SafeHttpError(
      "SSRF_BLOCKED_IP",
      `Numeric/hex IP encoding '${preNormalizedHost}' is prohibited.`
    );
  }
  const preOctets = preNormalizedHost.split(".");
  if (
    preOctets.length === 4 &&
    preOctets.every((part) => /^(0x[0-9a-f]+|\d+)$/i.test(part)) &&
    preOctets.some((part) => /^0\d+$/.test(part) || /^0x/i.test(part))
  ) {
    throw new SafeHttpError(
      "SSRF_BLOCKED_IP",
      `Octal or hexadecimal IPv4 encoding '${preNormalizedHost}' is prohibited.`
    );
  }

  // If the parsed hostname is an IP literal, immediately verify it against prohibited IP ranges
  if (net.isIP(rawHostname) !== 0) {
    const ipCheck = isProhibitedIpAddress(rawHostname);
    if (ipCheck.prohibited) {
      throw new SafeHttpError(
        "SSRF_BLOCKED_IP",
        ipCheck.reason ?? `IP address '${rawHostname}' is prohibited.`
      );
    }
  }

  return parsed;
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue;
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lower)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = Array.isArray(val) ? val.join(", ") : String(val);
    }
  }
  return sanitized;
}

async function defaultResolveHostname(
  hostname: string
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({
    address: r.address,
    family: (r.family === 6 ? 6 : 4) as 4 | 6
  }));
}

/**
 * Executes an outbound HTTP request with strict SSRF and resource-exhaustion protections:
 * 1. Validates URL protocol (`http:` / `https:`), forbids credentials, and blocks internal hostnames.
 * 2. Resolves all DNS records (`A` / `AAAA`) and verifies **every** resolved IP against `isProhibitedIpAddress`.
 *    If any record in a multi-record DNS answer is private/loopback/reserved, the entire request is blocked.
 * 3. Pins the validated IP address directly into the socket `lookup` function so DNS rebinding between
 *    validation and TCP connection is impossible, while preserving original `Host` and TLS `servername` (SNI).
 * 4. Rejects all `3xx` redirects fail-closed (`HTTP_REDIRECT_BLOCKED`).
 * 5. Enforces strict timeout (`MAX_HTTP_TIMEOUT_MS`) and response byte ceiling (`MAX_HTTP_RESPONSE_BYTES`).
 * 6. Redacts sensitive request and response headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, etc.).
 */
export async function executeSafeHttpRequest(
  options: SafeHttpRequestOptions
): Promise<SafeHttpResponse> {
  const parsedUrl = validateTargetUrlSyntax(options.url);
  const rawHost = parsedUrl.hostname.replace(/^\[|\]$/g, "");
  const timeoutMs = Math.min(
    Math.max(100, options.timeoutMs ?? MAX_HTTP_TIMEOUT_MS),
    MAX_HTTP_TIMEOUT_MS
  );
  const maxBytes = Math.min(
    Math.max(1024, options.maxResponseBytes ?? MAX_HTTP_RESPONSE_BYTES),
    MAX_HTTP_RESPONSE_BYTES
  );

  // Resolve and validate all IP addresses for target host
  let resolvedAddresses: Array<{ address: string; family: 4 | 6 }>;
  const literalFamily = net.isIP(rawHost);
  if (literalFamily === 4 || literalFamily === 6) {
    resolvedAddresses = [{ address: rawHost, family: literalFamily }];
  } else {
    try {
      const resolver = options.resolveHostname ?? defaultResolveHostname;
      resolvedAddresses = await resolver(rawHost);
    } catch (err) {
      throw new SafeHttpError(
        "SSRF_DNS_FAILURE",
        `Failed to resolve hostname '${rawHost}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (resolvedAddresses.length === 0) {
    throw new SafeHttpError(
      "SSRF_DNS_FAILURE",
      `Hostname '${rawHost}' did not resolve to any IP addresses.`
    );
  }

  // Every resolved IP must pass SSRF inspection (prevents mixed public/private DNS answers)
  for (const entry of resolvedAddresses) {
    const check = isProhibitedIpAddress(entry.address);
    if (check.prohibited) {
      throw new SafeHttpError(
        "SSRF_BLOCKED_IP",
        `Destination IP '${entry.address}' for host '${rawHost}' is blocked: ${check.reason}`,
        { host: rawHost, blockedIp: entry.address }
      );
    }
  }

  const pinnedTarget = options.__testConnectAddress ?? resolvedAddresses[0]!;

  // Custom lookup function pins socket connection to the exact validated IP (defeats DNS rebinding)
  const pinnedLookup: LookupFunction = (_hostname, lookupOpts, callback) => {
    if (typeof lookupOpts === "object" && lookupOpts !== null && lookupOpts.all) {
      callback(null, [
        { address: pinnedTarget.address, family: pinnedTarget.family }
      ]);
      return;
    }
    callback(null, pinnedTarget.address, pinnedTarget.family);
  };

  // Build request headers
  const outgoingHeaders: Record<string, string> = {
    "User-Agent": "FlowForge-Engine/0.3",
    Accept: "application/json, text/plain, */*"
  };

  for (const pair of options.headers ?? []) {
    const k = pair.key.trim();
    if (!k) continue;
    // Prevent CRLF header injection
    if (/[\r\n]/.test(k) || /[\r\n]/.test(pair.value)) {
      continue;
    }
    outgoingHeaders[k] = pair.value;
  }

  const hasBody =
    options.method !== "GET" &&
    options.body !== undefined &&
    options.body.length > 0;

  if (hasBody && !Object.keys(outgoingHeaders).some((k) => k.toLowerCase() === "content-type")) {
    outgoingHeaders["Content-Type"] = "application/json";
  }

  const redactedRequestHeaders = redactHeaders(outgoingHeaders);
  const startTime = Date.now();
  const isHttps = parsedUrl.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise<SafeHttpResponse>((resolve, reject) => {
    let settled = false;
    const failOnce = (err: SafeHttpError) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = transport.request(
      {
        protocol: parsedUrl.protocol,
        hostname: rawHost,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method,
        headers: outgoingHeaders,
        lookup: pinnedLookup,
        servername: net.isIP(rawHost) ? undefined : rawHost,
        rejectUnauthorized: true,
        timeout: timeoutMs
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        // Block all 3xx redirects fail-closed
        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          failOnce(
            new SafeHttpError(
              "HTTP_REDIRECT_BLOCKED",
              `HTTP redirect (${statusCode}) from '${parsedUrl.origin}' is blocked by security policy.`,
              { statusCode }
            )
          );
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        res.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > maxBytes) {
            req.destroy();
            failOnce(
              new SafeHttpError(
                "HTTP_RESPONSE_TOO_LARGE",
                `HTTP response exceeded maximum allowed size of ${maxBytes} bytes.`,
                { maxBytes }
              )
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          if (settled) return;
          settled = true;

          const durationMs = Math.max(0, Date.now() - startTime);
          const fullBuffer = Buffer.concat(chunks);
          const rawText = fullBuffer.toString("utf8");
          const sanitizedHeaders = redactHeaders(res.headers);

          let parsedBody: unknown = rawText;
          const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
          if (contentType.includes("application/json") && rawText.trim().length > 0) {
            try {
              parsedBody = JSON.parse(rawText);
            } catch {
              parsedBody = rawText;
            }
          }

          resolve({
            status: statusCode,
            statusText: res.statusMessage ?? "",
            headers: sanitizedHeaders,
            body: parsedBody,
            rawBodyPreview: rawText.slice(0, 4096),
            truncated: rawText.length > 4096,
            durationMs,
            redactedRequestHeaders
          });
        });

        res.on("error", (err) => {
          failOnce(
            new SafeHttpError(
              "HTTP_NETWORK_ERROR",
              `Error reading HTTP response: ${err.message}`
            )
          );
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      failOnce(
        new SafeHttpError(
          "HTTP_TIMEOUT",
          `HTTP request timed out after ${timeoutMs}ms.`,
          { timeoutMs }
        )
      );
    });

    req.on("error", (err) => {
      failOnce(
        new SafeHttpError(
          "HTTP_NETWORK_ERROR",
          `Outbound HTTP request failed: ${err.message}`
        )
      );
    });

    if (hasBody && options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
