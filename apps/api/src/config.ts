import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN is required")
    .refine(
      (val) =>
        val
          .split(",")
          .map((s) => s.trim())
          .every((origin) => origin !== "*" && /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(origin)),
      "CORS_ORIGIN must be a comma-separated list of explicit http(s) origins and cannot contain wildcard '*'"
    )
    .default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters long"),
  CSRF_SECRET: z
    .string()
    .min(32, "CSRF_SECRET must be at least 32 characters long"),
  RUN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RUN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60)
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === "production";

  const rawSessionSecret =
    env.SESSION_SECRET ??
    (!isProd ? "dev-only-session-secret-minimum-32-chars-flowforge-local" : undefined);
  const rawCsrfSecret =
    env.CSRF_SECRET ??
    (!isProd ? "dev-only-csrf-secret-minimum-32-chars-flowforge-local-key" : undefined);

  const parsed = EnvSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    API_PORT: env.API_PORT,
    CORS_ORIGIN: env.CORS_ORIGIN,
    SESSION_SECRET: rawSessionSecret,
    CSRF_SECRET: rawCsrfSecret,
    RUN_RATE_LIMIT_WINDOW_MS: env.RUN_RATE_LIMIT_WINDOW_MS,
    RUN_RATE_LIMIT_MAX: env.RUN_RATE_LIMIT_MAX
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
    );
  }

  return parsed.data;
}
