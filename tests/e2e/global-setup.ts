/**
 * Playwright global setup: run the login flow once before any test
 * spec executes, save the resulting storage state to disk so that
 * each test file can reuse it via launchAuthedExtensionContext.
 *
 * Skips silently if test credentials aren't set — unauth specs still
 * run, auth specs skip themselves via skipIfNoCreds().
 */
import { loginAndCacheStorageState, hasTestCreds } from './auth.fixture';

export default async function globalSetup() {
  if (!hasTestCreds) {
    console.log('[e2e] TEST_USER_EMAIL / TEST_USER_PASSWORD not set, skipping auth setup');
    return;
  }
  console.log('[e2e] Running login flow to cache auth state...');
  const path = await loginAndCacheStorageState();
  if (path) console.log('[e2e] Auth state cached at', path);
}
