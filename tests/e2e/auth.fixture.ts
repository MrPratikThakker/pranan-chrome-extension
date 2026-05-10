/**
 * Playwright auth fixture for the Pranan extension e2e tests.
 *
 * Strategy: Playwright's standard "storage state" pattern.
 *
 *   1. Once per test run (in global setup), navigate to
 *      https://app.pranan.ai/login, sign in with the test account
 *      credentials from env vars, wait for /home to load.
 *   2. Save the resulting cookies + localStorage to disk.
 *   3. Each individual test loads that state and is instantly authed.
 *
 * Why not a custom seed endpoint: Supabase SSR cookies are not just a
 * JWT — they're chunked, base64-encoded session objects with specific
 * format. Easier to do the real login flow once and let Supabase
 * handle the cookie shape.
 *
 * Test account expectations (set up out-of-band by Pratik):
 *   - Account email + password stored as GitHub Actions secrets
 *     TEST_USER_EMAIL and TEST_USER_PASSWORD on the extension repo
 *   - Account exists on pranan.ai with onboarding completed
 *   - Account is in the "team" tier (matches Pratik's account shape)
 *
 * The login fixture skips gracefully if creds aren't set, so unauth
 * tests still run.
 */
import { test as base, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-equivalent of __dirname (project has "type": "module" in package.json)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { existsSync, mkdirSync } from 'node:fs';

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', 'dist');
const STORAGE_STATE_DIR = path.resolve(__dirname, '..', '..', '.playwright-state');
const STORAGE_STATE_PATH = path.resolve(STORAGE_STATE_DIR, 'auth-state.json');

if (!existsSync(STORAGE_STATE_DIR)) mkdirSync(STORAGE_STATE_DIR, { recursive: true });

export const APP_ORIGIN = process.env.PRANAN_APP_ORIGIN || 'https://app.pranan.ai';
export const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || '';
export const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || '';

export const hasTestCreds = !!(TEST_USER_EMAIL && TEST_USER_PASSWORD);

/**
 * Spin up a fresh Chromium context, navigate to login, fill creds,
 * wait for /home, then return the context. Caller is responsible for
 * persisting storageState if reuse across tests is desired.
 */
export async function loginAndCacheStorageState(): Promise<string | null> {
  if (!hasTestCreds) {
    console.warn('[auth.fixture] TEST_USER_EMAIL or TEST_USER_PASSWORD missing -- auth tests will be skipped');
    return null;
  }
  const isCI = !!process.env.CI;
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(isCI ? ['--headless=new'] : []),
    ],
  });
  const page = await ctx.newPage();
  await page.goto(`${APP_ORIGIN}/login`);
  // Click "Sign in with email" if the form isn't immediately visible
  const emailInput = page.getByPlaceholder(/email/i).first();
  await emailInput.waitFor({ state: 'visible', timeout: 10_000 }).catch(async () => {
    // The login page might have a "Sign in with email" toggle button first
    const toggle = page.getByRole('button', { name: /sign in with email/i });
    if (await toggle.count() > 0) await toggle.click();
    await emailInput.waitFor({ state: 'visible', timeout: 5_000 });
  });
  await emailInput.fill(TEST_USER_EMAIL);
  await page.getByPlaceholder(/password/i).first().fill(TEST_USER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Race the redirect against any visible auth error so we don't wait
  // 15 seconds just to time out when the credentials are invalid /
  // rate-limited. If the supabase signInWithPassword call surfaces an
  // error (locked account, wrong password, rate-limited), the login
  // page renders the error message in a div with role='alert' (or in
  // the form-error span). Surface that fast with a clear message.
  const redirectPromise = page.waitForURL(/\/home|\/dashboard|\/triage/, { timeout: 15_000 });
  const errorPromise = page.waitForSelector(
    '[role="alert"], [data-testid="auth-error"], .error-message',
    { timeout: 15_000, state: 'visible' },
  ).then(async (el) => {
    const text = await el.textContent();
    throw new Error(`[auth.fixture] Sign-in failed with on-page error: "${text?.trim() || '(empty)'}". Check TEST_USER_EMAIL / TEST_USER_PASSWORD GH secrets — the test account may be locked, rate-limited, or the password may have rotated.`);
  });
  try {
    await Promise.race([redirectPromise, errorPromise]);
  } catch (err) {
    // Augment the timeout with diagnostic context (current URL, page
    // title, and any visible error text) so the CI log immediately
    // explains WHY auth failed instead of just "timed out".
    const url = page.url();
    const title = await page.title().catch(() => '?');
    const visibleErr = await page.locator('[role="alert"], .error-message').first().textContent().catch(() => null);
    console.error(`[auth.fixture] sign-in did not redirect. url=${url} title=${title} on-page-error=${visibleErr || '(none)'}`);
    throw err;
  }
  // Capture the storage state (cookies + localStorage)
  const state = await ctx.storageState();
  // Write to disk so Playwright tests can reuse it via storageState option
  const fs = await import('node:fs/promises');
  await fs.writeFile(STORAGE_STATE_PATH, JSON.stringify(state, null, 2));
  await ctx.close();
  return STORAGE_STATE_PATH;
}

/**
 * Launch a fresh persistent context with the extension loaded AND the
 * cached auth-state cookies pre-applied. Returns context + extension ID.
 */
export async function launchAuthedExtensionContext(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const isCI = !!process.env.CI;
  // We need a persistent context for extensions but we also want to
  // pre-seed cookies from the saved storage state. Solution: launch
  // the context, manually addCookies from the saved state.
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(isCI ? ['--headless=new'] : []),
    ],
  });
  // Apply saved auth cookies if available
  if (existsSync(STORAGE_STATE_PATH)) {
    try {
      const fs = await import('node:fs/promises');
      const state = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, 'utf-8'));
      if (state.cookies?.length) await context.addCookies(state.cookies);
    } catch (e) {
      console.warn('[auth.fixture] Failed to load storage state:', e);
    }
  }
  // Wait for the extension's service worker to register
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  }
  const extensionId = worker.url().split('/')[2];
  return { context, extensionId };
}

/**
 * Test helper: skip if creds aren't set, so the suite still runs in
 * environments where the secrets haven't been configured (e.g. forks).
 */
export const test = base.extend({});
export const skipIfNoCreds = (reason = 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set') => {
  test.skip(!hasTestCreds, reason);
};

export { expect };
