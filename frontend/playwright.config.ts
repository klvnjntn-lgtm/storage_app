import { defineConfig, devices } from '@playwright/test';

// Browser smoke tests (e2e/*.spec.ts) against a running WareSys: the
// backend on a throwaway database with SELF_SERVE_BILLING=true and no
// XENDIT_SECRET_KEY (so the test checkout is used), and this frontend
// pointed at it. See e2e/README.md.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    // Any local Chrome/Chromium instead of Playwright's download, e.g. the
    // one Puppeteer already fetched for PDF rendering.
    ...(process.env.E2E_CHROME_PATH && { launchOptions: { executablePath: process.env.E2E_CHROME_PATH } }),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
