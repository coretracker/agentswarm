import { defineConfig, devices } from "@playwright/test";

const captureVideo = process.env.PLAYWRIGHT_CAPTURE_VIDEO === "1";
const baseURL = process.env.AGENTSWARM_UI_BASE_URL ?? `http://localhost:${process.env.PUBLIC_PORT ?? "3217"}`;

export default defineConfig({
  testDir: "apps/web/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: captureVideo ? "retain-on-failure" : "off",
    viewport: { width: 1280, height: 720 }
  },
  outputDir: "test-results/playwright",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
