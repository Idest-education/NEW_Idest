import { defineConfig } from "@playwright/test";

/**
 * End-to-end cover for the one thing unit tests cannot reach: a real essay
 * travelling student -> queue -> AI worker -> teacher -> published result.
 *
 * The services are expected to be running already (web on 3000, API on 3001,
 * ai-service worker against a LOCAL broker). The worker makes real provider
 * calls, so a run costs a cent or two and is not meant for CI as it stands.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The flow is one story told in order: submit, score, review, publish.
  fullyParallel: false,
  workers: 1,
  // Scoring goes through a queue and a hosted model; the rate floor alone can
  // hold a call for 6s before it is even sent.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
