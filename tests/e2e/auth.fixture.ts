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

  // Capture every Supabase auth response so we can see WHY auth failed.
  // The visible-error-on-page detection misses cases where Supabase
  // returns 400/429/etc and the React code silently swallows or the
  // setError fires before our selector catches it. This network log
  // is the source of truth — what Supabase actually returned.
  const authResponses: Array<{ url: string; status: number; body: string }> = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (!/supabase\.co\/auth\/v1\/token/.test(url)) return;
    try {
      const body = await resp.text().catch(() => '(could not read body)');
      authResponses.push({
        url,
        status: resp.status(),
        body: body.slice(0, 500),
      });
    } catch { /* ignore */ }
  });

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

  // Race the redirect against the SPECIFIC auth-error testid (the
  // [data-testid=auth-error] div on /login). v0.5.5 fixture used a
  // broad role=alert selector which matched unrelated empty toast
  // containers — that was the "(empty)" noise in earlier runs.
  const redirectPromise = page.waitForURL(/\/home|\/dashboard|\/triage/, { timeout: 15_000 });
  const errorPromise = page.waitForSelector(
    '[data-testid="auth-error"]',
    { timeout: 15_000, state: 'visible' },
  ).then(async (el) => {
    const text = (await el.textContent())?.trim() || '(visible-but-empty)';
    throw new Error(`[auth.fixture] Login surfaced an error: "${text}"`);
  });

  try {
    await Promise.race([redirectPromise, errorPromise]);
  } catch (err) {
    // Build the most informative diagnostic possible: current URL +
    // visible auth error + every Supabase /auth/v1/token response we
    // saw. This collapses the typical 4-step "rerun locally to debug"
    // loop into a single CI log inspection.
    const url = page.url();
    const title = await page.title().catch(() => '?');
    const visibleErr = await page
      .locator('[data-testid="auth-error"]')
      .first()
      .textContent()
      .catch(() => null);

    console.error('========== [auth.fixture] SIGN-IN FAILED ==========');
    console.error(`url=${url}`);
    console.error(`title=${title}`);
    console.error(`visible-error="${(visibleErr || '').trim() || '(none)'}"`);
    console.error(`supabase auth/v1/token responses: ${authResponses.length}`);
    for (const r of authResponses) {
      console.error(`  [${r.status}] ${r.url}`);
      console.error(`    body: ${r.body}`);
    }
    if (authResponses.length === 0) {
      console.error('  No /auth/v1/token requests captured. Either the click did not trigger signInWithPassword (page rendering issue), or the page is making auth calls to a different host. Check PRANAN_APP_ORIGIN.');
    }
    console.error('====================================================');

    // Save a screenshot so the artifact upload step has something to
    // attach. CI was uploading empty playwright-report/ because the
    // throw happened before the test runner could write its trace.
    try {
      const fs2 = await import('node:fs/promises');
      await fs2.mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/auth-failure.png', fullPage: true });
      console.error('Screenshot saved: test-results/auth-failure.png');
    } catch (e) {
      console.error('Screenshot save failed:', e);
    }

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
