import { defineConfig } from "@playwright/test";

const PORT = 3100;
const E2E_ENV = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/follow_ai_e2e",
  SESSION_SECRET: "e2e-session-secret-at-least-32-characters-long",
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  LLM_PROVIDER: "mock",
  STORAGE_LOCAL_DIR: "./storage-e2e",
  DEMO_TOOLS: "true",
  CRON_SECRET: "e2e-cron",
  WEBHOOK_SIGNING_SECRET: "e2e-webhook",
};
Object.assign(process.env, E2E_ENV);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: E2E_ENV,
  },
});
