/**
 * Who may ask the service worker for what.
 *
 * Kept free of worker side effects so the rules can be tested directly
 * (audit EXT-33).
 */

import { APP_ORIGIN } from '@/lib/config';

/** Canonical relationship tiers, matching /api/companion/tier-override. */
export const VALID_TIERS: ReadonlySet<string> = new Set([
  'inner_circle', 'team', 'client', 'prospect', 'vendor', 'network',
]);

export function isValidTier(value: unknown): value is string {
  return typeof value === 'string' && VALID_TIERS.has(value);
}

function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    // protocol + host rather than .origin: URL.origin is "null" for
    // chrome-extension:// URLs in some runtimes.
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * SECURITY (sweep 2026-06-09): privileged message types (auth token storage)
 * must only be honored from the extension's own UI pages or a content script
 * running on the Pranan web-app origin. Content scripts on Gmail/Slack/LinkedIn
 * share the same runtime id, so id alone is not enough; the discriminator is
 * sender.url / sender.origin.
 *
 * Origins are compared exactly. A prefix match on the URL also accepted
 * lookalike hosts such as app.pranan.ai.evil.com (audit EXT-18).
 */
export function isTrustedPrivilegedSender(
  sender: chrome.runtime.MessageSender,
  runtimeId: string = chrome.runtime.id,
  appOrigin: string = APP_ORIGIN,
): boolean {
  if (sender.id !== undefined && sender.id !== runtimeId) return false;
  const fromExtensionUi = originOf(sender.url) === `chrome-extension://${runtimeId}`;
  const fromAppOrigin = sender.origin === appOrigin || originOf(sender.url) === appOrigin;
  return fromExtensionUi || fromAppOrigin;
}

/**
 * A message from this extension's own content script on the given site
 * (for example Gmail's one-click tier correction, audit EXT-17 / XP-12, or a
 * posted LinkedIn comment). Web pages cannot message the worker at all, and
 * another extension has a different id.
 */
export function isOwnContentScript(
  sender: chrome.runtime.MessageSender,
  siteOrigin: string,
  runtimeId: string = chrome.runtime.id,
): boolean {
  if (sender.id !== runtimeId || !sender.tab) return false;
  return originOf(sender.url ?? sender.tab.url) === siteOrigin;
}
