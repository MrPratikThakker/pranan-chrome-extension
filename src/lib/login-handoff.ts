/**
 * Binding the web-app sign-in handoff to a login the extension started.
 *
 * Audit EXT-09: the extension accepted tokens from any page script on
 * app.pranan.ai, checked only by origin. An XSS anywhere on the app could
 * sign the extension into an attacker's account, after which the victim's
 * Gmail context, drafts and voice samples would flow to that account.
 *
 * Now every "Connect" (popup, side panel, first install) records a random
 * state and a start time in chrome.storage.session (trusted contexts only)
 * before opening the login page. The service worker accepts a handoff only
 * while such a login is pending, only once, and only within
 * LOGIN_HANDOFF_WINDOW_MS. When the app echoes the state back, it must match.
 * When the app hands over its one-time nonce instead of the tokens, the
 * service worker exchanges it itself, so the tokens never touch page script.
 */

import { appUrl } from './config';

export const PENDING_LOGIN_KEY = 'pendingCompanionLogin';

/** Long enough for a magic-link email round trip, short enough to matter. */
export const LOGIN_HANDOFF_WINDOW_MS = 15 * 60 * 1000;

export interface PendingLogin {
  state: string;
  startedAt: number;
}

export type HandoffCheck =
  | { ok: true; pending: PendingLogin }
  | { ok: false; reason: 'no_pending_login' | 'expired' | 'state_mismatch' };

function randomState(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function companionLoginUrl(state: string): string {
  return appUrl(`/login?source=companion&ext_state=${encodeURIComponent(state)}`);
}

/** Record a pending login. Trusted contexts only (popup, side panel, worker). */
export async function recordPendingLogin(now = Date.now()): Promise<PendingLogin> {
  const pending: PendingLogin = { state: randomState(), startedAt: now };
  await chrome.storage.session.set({ [PENDING_LOGIN_KEY]: pending });
  return pending;
}

/** Record a pending login and open the app's companion sign-in page. */
export async function beginCompanionLogin(): Promise<void> {
  const pending = await recordPendingLogin();
  await chrome.tabs.create({ url: companionLoginUrl(pending.state) });
}

/**
 * Check a handoff against the pending login and consume it on success, so the
 * same login can never be used twice. A wrong state does not consume the
 * pending login, so a hostile page cannot cancel the real sign-in by posting
 * garbage first.
 */
export async function consumePendingLogin(presentedState: unknown, now = Date.now()): Promise<HandoffCheck> {
  let pending: PendingLogin | undefined;
  try {
    const stored = await chrome.storage.session.get(PENDING_LOGIN_KEY);
    pending = stored?.[PENDING_LOGIN_KEY] as PendingLogin | undefined;
  } catch {
    pending = undefined;
  }
  if (!pending || typeof pending.state !== 'string' || typeof pending.startedAt !== 'number') {
    return { ok: false, reason: 'no_pending_login' };
  }
  if (now - pending.startedAt > LOGIN_HANDOFF_WINDOW_MS || now < pending.startedAt) {
    try { await chrome.storage.session.remove(PENDING_LOGIN_KEY); } catch { /* pass */ }
    return { ok: false, reason: 'expired' };
  }
  if (presentedState !== undefined && presentedState !== null && presentedState !== pending.state) {
    return { ok: false, reason: 'state_mismatch' };
  }
  try { await chrome.storage.session.remove(PENDING_LOGIN_KEY); } catch { /* pass */ }
  return { ok: true, pending };
}

/**
 * Put a consumed login back when the handoff then failed (expired nonce,
 * validation error), so the user can retry inside the original window. The
 * original start time is kept, so this never extends the window.
 */
export async function restorePendingLogin(pending: PendingLogin): Promise<void> {
  try { await chrome.storage.session.set({ [PENDING_LOGIN_KEY]: pending }); } catch { /* pass */ }
}
