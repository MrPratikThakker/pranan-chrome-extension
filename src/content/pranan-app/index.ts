/**
 * Pranan Companion -- Content Script for app.pranan.ai
 *
 * Runs on app.pranan.ai to facilitate auth token exchange.
 * Listens for:
 * 1. postMessage from the companion-callback page
 * 2. A hidden DOM element with the token (fallback)
 *
 * Forwards the token to the service worker which stores it in
 * chrome.storage.local and broadcasts to the side panel.
 */

import { safeSendMessage } from '@/lib/runtime';

console.log('[Pranan Content Script] Loaded on', window.location.href);

// Listen for postMessage from the companion-callback page
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== 'PRANAN_COMPANION_AUTH') return;

  const token = event.data.token;
  if (!token || typeof token !== 'string') return;
  const refreshToken = typeof event.data.refreshToken === 'string' ? event.data.refreshToken : undefined;

  console.log('[Pranan Content Script] Received token via postMessage, forwarding to service worker...');

  // Forward to service worker
  // safeSendMessage is promise-based, and it already swallows the dead-context
  // case that chrome.runtime.lastError was here to report.
  safeSendMessage<{ ok?: boolean }>(
    { type: 'AUTH_TOKEN_FROM_WEB', token, refreshToken }
  ).then(
    (response) => {
      if (response?.ok) {
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
