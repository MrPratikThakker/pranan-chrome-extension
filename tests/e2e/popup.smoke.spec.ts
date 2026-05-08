/**
 * Single smoke test: popup loads without errors.
 *
 * Why this scope: catches the bug class we keep hitting where some
 * code path in the popup throws on mount and the popup renders empty
 * or broken. Doesn't try to test auth flows yet (needs test account
 * setup which is a bigger investment).
 *
 * Future tests in this directory should follow the same pattern:
 *   - Launch persistent context with extension loaded
 *   - Resolve the extension ID dynamically (it's a hash of the load path)
 *   - Navigate to chrome-extension://<id>/popup.html (or sidepanel.html)
 *   - Assert what should be rendered
 *   - Capture console errors as a hard failure signal
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-equivalent of __dirname (project has "type": "module" in package.json)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', 'dist');

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  // CI runs in 'new' headless mode (Chromium's modern headless that
  // supports extensions since 2024). Local dev keeps headed mode for
  // visibility into what the test is doing.
  const isCI = !!process.env.CI;
  context = await chromium.launchPersistentContext('', {
    headless: false,
    channel: isCI ? undefined : undefined,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(isCI ? ['--headless=new'] : []),
    ],
  });

  // Resolve the extension ID from the loaded background service worker.
  // MV3 SW shows up under context.serviceWorkers() once the extension
  // is registered. Wait up to 10s for the SW to register on slow CI runners.
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  }
  const swUrl = worker.url(); // chrome-extension://<id>/background.js
  extensionId = swUrl.split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
});

test('popup renders without console errors', async () => {
  expect(extensionId).toBeTruthy();

  const errors: string[] = [];
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // Popup root mounts; the brand text 'Pranan' is always rendered
  // regardless of auth state, so it's a stable selector.
  await expect(page.getByText('Pranan').first()).toBeVisible({ timeout: 5000 });

  // Hard-fail if anything logged to console.error during mount.
  // Common pre-fix breakages: missing manifest fields, content-script
  // import errors, runtime exceptions in useEffect.
  expect(errors, `Popup logged console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('sidepanel renders without console errors', async () => {
  expect(extensionId).toBeTruthy();

  const errors: string[] = [];
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.getByText(/Pranan|Connect/i).first()).toBeVisible({ timeout: 5000 });
  expect(errors, `Sidepanel logged console errors:\n${errors.join('\n')}`).toEqual([]);
});
