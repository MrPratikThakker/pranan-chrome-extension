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

console.log('[Pranan Content Script] Loaded on', window.location.href);

// Listen for postMessage from the companion-callback page
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== 'PRANAN_COMPANION_AUTH') return;

  const token = event.data.token;
  if (!token || typeof token !== 'string') return;

  console.log('[Pranan Content Script] Received token via postMessage, forwarding to service worker...');

  // Forward to service worker
  chrome.runtime.sendMessage(
    { type: 'AUTH_TOKEN_FROM_WEB', token },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Pranan Companion] Failed to send token to service worker:', chrome.runtime.lastError.message);
        return;
      }

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

// Fallback: check for token in a hidden DOM element (polling for 5 seconds)
function checkDomToken() {
  const el = document.getElementById('pranan-companion-token');
  if (!el) return false;

  const token = el.getAttribute('data-token');
  if (!token) return false;

  console.log('[Pranan Content Script] Found token in DOM element, forwarding to service worker...');

  chrome.runtime.sendMessage(
    { type: 'AUTH_TOKEN_FROM_WEB', token },
    (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.ok) {
        const ack = document.createElement('div');
        ack.id = 'pranan-companion-ack';
        ack.style.display = 'none';
        document.body.appendChild(ack);
      }
    }
  );

  return true;
}

// Poll for the DOM token element (the page might still be rendering)
let attempts = 0;
const interval = setInterval(() => {
  attempts++;
  if (checkDomToken() || attempts >= 10) {
    clearInterval(interval);
  }
}, 500);
