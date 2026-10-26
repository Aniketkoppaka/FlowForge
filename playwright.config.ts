import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: "node apps/api/dist/index.js",
          port: 4000,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: {
            NODE_ENV: "production",
            API_PORT: "4000",
            API_REPOSITORY_DRIVER: process.env.API_REPOSITORY_DRIVER ?? "memory",
            CORS_ORIGIN: "http://localhost:3000",
            SESSION_SECRET: "dev-only-session-secret-minimum-32-chars-flowforge-local",
            CSRF_SECRET: "dev-only-csrf-secret-minimum-32-chars-flowforge-local-key"
          }
        },
        {
          command: "npm --workspace=@flowforge/web run start",
          port: 3000,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: {
            NODE_ENV: "production",
            NEXT_PUBLIC_API_URL: "http://localhost:4000"
          }
        }
      ]
});
