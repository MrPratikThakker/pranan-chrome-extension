import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * Playwright config for the Pranan Chrome extension.
 *
 * Strategy: load the unpacked extension into a persistent Chromium
 * context. The extension's pages (popup.html, sidepanel.html) load
 * via chrome-extension://<id>/ URLs; we test those directly without
 * needing real Gmail/LinkedIn page DOMs.
 *
 * What's IN scope for this scaffold:
 *   - Build the extension before running tests (pretest hook)
 *   - Single smoke test that verifies popup renders without errors
 *
 * What's OUT of scope (queued for follow-on):
 *   - Authenticated flows (need test account + cookie injection)
 *   - Cross-tab Gmail/Slack/LinkedIn DOM tests
 *   - Visual regression snapshots
 *
 * Add new tests as new specs in tests/e2e/.
 */
const EXTENSION_PATH = path.resolve(__dirname, 'dist');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false, // extension contexts don't parallelize cleanly
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    headless: false, // 'new' headless mode if running in CI (see launchOptions); local dev keeps headed for visibility
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
            '--disable-dev-shm-usage',
          ],
        },
      },
    },
  ],
});
