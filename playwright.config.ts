import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 5180);

export default defineConfig({
  testDir: "./e2e",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuses a running `npm run dev`; starts one otherwise.
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
