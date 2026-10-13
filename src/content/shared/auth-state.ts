/**
 * Whether the user is signed in to Pranan, as far as a content script can know.
 *
 * Content scripts cannot read the session tokens (audit EXT-10), so until this
 * existed the Gmail script had no idea. A signed-out person saw the complete
 * Pranan control, typed an instruction, pressed Generate and only then got a
 * line of text telling them to go and sign in somewhere else.
 *
 * The service worker is the only place that knows. This module asks it once
 * (GET_AUTH_STATE), then listens for AUTH_STATE_CHANGED, which the worker sends
 * to Gmail tabs on sign-in and sign-out. It also asks again when the tab comes
 * back into view while not signed in: that is exactly the moment someone
 * returns from the sign-in tab, and it covers a broadcast that never arrived.
 *
 * Only a boolean ever crosses over.
 *
 * 'unknown' is a real state, and it is treated as signed in by the UI: the
 * worker could not tell (offline, server blip), and hiding a working feature
 * behind a sign-in button on a guess would be worse than the old behaviour.
 */

import { safeSendMessage } from '@/lib/runtime';
import { SIGN_IN_LABEL } from '@/lib/draft-error-message';

export type AuthState = 'unknown' | 'signed_in' | 'signed_out';

let current: AuthState = 'unknown';
const listeners = new Set<(state: AuthState) => void>();

export function getAuthState(): AuthState {
  return current;
}

/** True only when the worker has said the user is signed out. */
export function isSignedOut(): boolean {
  return current === 'signed_out';
}

export function setAuthState(next: AuthState): void {
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) {
    try { listener(next); } catch { /* one broken surface must not stop the rest */ }
  }
}

/** Subscribe to changes. Returns the unsubscribe function. */
export function onAuthStateChange(listener: (state: AuthState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Run `apply` now and on every change, for as long as `host` is on the page.
 * Stops by itself once the host has been attached and then removed, so a
 * closed compose does not leave a listener behind.
 */
export function bindAuthState(host: Node, apply: (state: AuthState) => void): () => void {
  let attached = host.isConnected;
  apply(current);
  const stop = onAuthStateChange((state) => {
    if (host.isConnected) attached = true;
    else if (attached) { stop(); return; }
    apply(state);
  });
  return stop;
}

function fromSignedIn(signedIn: unknown): AuthState {
  if (signedIn === true) return 'signed_in';
  if (signedIn === false) return 'signed_out';
  return 'unknown';
}

let inFlight: Promise<AuthState> | null = null;
let lastAskedAt = 0;

/**
 * Ask the worker. A reply of "cannot tell", or no reply at all, leaves the
 * current state alone, so a blip never flips a signed-in control to signed out
 * or the other way round.
 */
export function refreshAuthState(): Promise<AuthState> {
  if (inFlight) return inFlight;
  lastAskedAt = Date.now();
  inFlight = safeSendMessage<{ signedIn?: boolean | null }>({ type: 'GET_AUTH_STATE' })
    .then((reply) => {
      const next = fromSignedIn(reply?.signedIn);
      if (next !== 'unknown') setAuthState(next);
      return current;
    })
    .catch(() => current)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Do not ask more often than this when the tab regains focus. */
const RECHECK_INTERVAL_MS = 5000;

let started = false;

/**
 * Start keeping the state current. Call once per content script. The message
 * listener never keeps the reply channel open (audit EXT-28).
 */
export function startAuthStateSync(): void {
  if (started) return;
  started = true;

  try {
    chrome.runtime.onMessage.addListener((message: { type?: string; payload?: { signedIn?: unknown } }) => {
      if (message?.type !== 'AUTH_STATE_CHANGED') return;
      const next = fromSignedIn(message.payload?.signedIn);
      if (next !== 'unknown') setAuthState(next);
    });
  } catch { /* extension context gone */ }

  const recheck = () => {
    if (current === 'signed_in') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (Date.now() - lastAskedAt < RECHECK_INTERVAL_MS) return;
    void refreshAuthState();
  };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('focus', recheck);

  void refreshAuthState();
}

/**
 * Start the extension's own sign-in handoff, the same one the popup's
 * "Continue to Pranan" and the side panel's "Connect to Pranan" start. The
 * worker records the pending login and opens the sign-in tab; a content script
 * can do neither. Resolves to false when the worker could not be reached.
 */
export async function requestSignIn(): Promise<boolean> {
  const reply = await safeSendMessage<{ ok?: boolean }>({ type: 'BEGIN_COMPANION_LOGIN' });
  return reply?.ok === true;
}

export { SIGN_IN_LABEL };
export const SIGNED_OUT_MESSAGE = 'You are signed out of Pranan. Sign in to draft replies in your voice.';
const SIGN_IN_OPENED_MESSAGE = 'Finish signing in on the tab that just opened. Pranan will be ready here when you are done.';
const SIGN_IN_FAILED_MESSAGE = 'Pranan could not open the sign-in page. Click the Pranan icon in the Chrome toolbar to sign in.';

/**
 * Make a button start sign-in, and report what happened in `hint` when one is
 * given. The button stays usable afterwards so a closed tab can be reopened.
 */
export function wireSignInButton(
  button: HTMLButtonElement,
  hint?: HTMLElement | null,
  copy: { opened?: string; failed?: string } = {},
): void {
  button.type = 'button';
  if (!button.textContent?.trim()) button.textContent = SIGN_IN_LABEL;
  const label = button.textContent || SIGN_IN_LABEL;
  let busy = false;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Opening sign-in...';
    void requestSignIn()
      .catch(() => false)
      .then((opened) => {
        busy = false;
        button.disabled = false;
        button.textContent = label;
        if (hint) {
          hint.textContent = opened
            ? (copy.opened || SIGN_IN_OPENED_MESSAGE)
            : (copy.failed || SIGN_IN_FAILED_MESSAGE);
        }
      });
  });
}

/** Test seam: forget everything, as if the script had just loaded. */
export function resetAuthStateForTests(): void {
  current = 'unknown';
  listeners.clear();
  inFlight = null;
  lastAskedAt = 0;
  started = false;
}
