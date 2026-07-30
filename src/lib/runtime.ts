/**
 * Talking to the background worker without dying when the extension goes away.
 *
 * Chrome tears down a content script's connection to its extension whenever the
 * extension is reloaded, updated or disabled -- but it leaves the already-injected
 * script running in every open tab. That orphaned script keeps handling clicks,
 * and the moment it touches chrome.runtime it throws:
 *
 *     Uncaught Error: Extension context invalidated.
 *
 * This is not a developer-only condition. It happens to every user on every
 * Chrome Web Store auto-update who has Gmail open at the time -- which, for an
 * email assistant, is most of them. From their side Pranan simply stops
 * responding until they happen to reload the tab, with nothing on screen to say
 * why. "It randomly stops working" is exactly how that reads.
 *
 * Two things matter here:
 *
 *  1. `chrome.runtime.sendMessage` throws SYNCHRONOUSLY on a dead context. A
 *     trailing `.catch()` never runs, because no promise is ever returned. Of
 *     the 48 call sites across the content scripts, the three that looked
 *     defensive were not.
 *
 *  2. Failing silently is its own bug. If we cannot reach the extension, say so
 *     once, quietly, rather than leaving a dead button.
 */

/** Is our connection to the extension still alive? */
export function isExtensionAlive(): boolean {
  try {
    // Reading .id throws on an invalidated context; it is the cheapest probe.
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

let noticeShown = false;

/**
 * Tell the user once, quietly, that the tab needs reloading. Called only when we
 * have actually failed to reach the extension, so it cannot nag.
 */
function showReloadNotice(): void {
  if (noticeShown || typeof document === 'undefined') return;
  noticeShown = true;
  const el = document.createElement('div');
  el.setAttribute('data-pranan-stale', '1');
  el.style.cssText = [
    'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
    'background:#1a0c2a', 'color:#fff', 'font:500 13px/1.4 system-ui,sans-serif',
    'padding:10px 14px', 'border-radius:8px', 'display:flex', 'gap:10px',
    'align-items:center', 'box-shadow:0 4px 14px rgba(0,0,0,.28)',
  ].join(';');
  const msg = document.createElement('span');
  msg.textContent = 'Pranan updated. Reload this tab to keep using it.';
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'background:#a78bfa;color:#1a0c2a;border:none;border-radius:6px;padding:5px 10px;font-weight:600;cursor:pointer';
  btn.addEventListener('click', () => location.reload());
  el.append(msg, btn);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 20000);
}

/**
 * sendMessage that cannot throw.
 *
 * Resolves to null when the extension is gone, so every caller degrades to "no
 * answer" instead of an uncaught error. Callers that already chain .catch() or
 * .then() keep working unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Defaults to `any` to match chrome.runtime.sendMessage, which Chrome's own
// types declare as Promise<any>. This is an untyped IPC boundary: the shape of
// a reply is whatever the service worker chose to send. Defaulting to `unknown`
// would be stricter than the thing it replaces and would force a cast at all 55
// call sites for no added safety. Callers that know the shape pass it
// explicitly, and several now do.
export async function safeSendMessage<T = any>(message: unknown): Promise<T | null> {
  if (!isExtensionAlive()) {
    showReloadNotice();
    return null;
  }
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch (err) {
    // Late invalidation: alive at the check, gone by the call.
    if (!isExtensionAlive()) showReloadNotice();
    else console.warn('[Pranan] sendMessage failed:', err);
    return null;
  }
}
