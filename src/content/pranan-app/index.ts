/**
 * Pranan Companion -- Content Script for the Pranan web app
 *
 * Runs on app.pranan.ai (and the staging or preview host in those builds) to
 * receive the sign-in handoff from the companion-callback page, which posts
 * PRANAN_COMPANION_AUTH with either:
 *
 *  - { nonce }                   the one-time sign-in nonce; the service worker
 *                                exchanges it, so tokens never touch page script
 *  - { token, refreshToken }     today's app, which exchanges the nonce itself
 *
 * plus an optional { state } echoed from the login URL.
 *
 * This script only forwards. The service worker decides: it accepts a handoff
 * only while a sign-in the extension started is pending (audit EXT-09), and
 * stores tokens where content scripts cannot read them (audit EXT-10).
 */

import { safeSendMessage } from '@/lib/runtime';

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.source !== window) return;
  if (event.data?.type !== 'PRANAN_COMPANION_AUTH') return;

  const nonce = typeof event.data.nonce === 'string' ? event.data.nonce : undefined;
  const token = typeof event.data.token === 'string' ? event.data.token : undefined;
  if (!nonce && !token) return;
  const refreshToken = typeof event.data.refreshToken === 'string' ? event.data.refreshToken : undefined;
  const state = typeof event.data.state === 'string' ? event.data.state : undefined;

  // safeSendMessage is promise-based, and it already swallows the dead-context
  // case that chrome.runtime.lastError was here to report.
  safeSendMessage<{ ok?: boolean }>(
    nonce
      ? { type: 'AUTH_TOKEN_FROM_WEB', nonce, state }
      : { type: 'AUTH_TOKEN_FROM_WEB', token, refreshToken, state }
  ).then(
    (response) => {
      if (response?.ok && !document.getElementById('pranan-companion-ack')) {
        // Signal success back to the page
        const ack = document.createElement('div');
        ack.id = 'pranan-companion-ack';
        ack.style.display = 'none';
        document.body.appendChild(ack);
      }
    }
  );
});

// NOTE: the legacy DOM-element token fallback (#pranan-companion-token) was
// removed 2026-06-08 (audit finding 5). The app no longer renders that
// element, and a token in the DOM would be readable by any page script.
// postMessage (origin-checked above) is the only handoff path.
