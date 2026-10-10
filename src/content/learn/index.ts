/**
 * "Remember this page" (Phase 3, see src/lib/work-sites.ts).
 *
 * Registered by the service worker only on sites the user added in the
 * popup. Shows one small button in the corner; nothing is read until the user
 * presses it. Then the visible text of this page goes to the service worker,
 * which checks the sender and the site again before sending it to Pranan.
 * Never offered on login or payment pages, or inside frames.
 */
import { claimContentScriptInstance } from '../shared/instance-guard';
import { looksLikeLoginPage, MIN_PAGE_TEXT, pageText } from './page-text';

interface LearnReply { ok?: boolean; suggested?: number; reason?: string; error?: string }

const HOST_ID = 'pranan-learn-host';

function message(reply: LearnReply | undefined): string {
  if (!reply) return 'Pranan could not be reached. Try again.';
  if (reply.ok) {
    const n = reply.suggested ?? 0;
    return n === 0
      ? 'Read. Nothing new worth remembering here.'
      : `${n} ${n === 1 ? 'suggestion' : 'suggestions'} sent to your Memory inbox for review.`;
  }
  switch (reply.reason) {
    case 'signed_out': return 'Sign in to Pranan for Chrome first.';
    case 'not_allowed': return 'This site is not on your list. Add it in the Pranan popup.';
    case 'blocked': return 'Pranan does not read this page.';
    case 'rate_limited': return 'You have saved a lot of pages this hour. Try again later.';
    case 'budget': return 'Your AI allowance for this month is used up.';
    default: return reply.error || 'Could not read this page. Try again.';
  }
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
      .row { display: flex; gap: 4px; }
      button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid rgba(109,40,217,.35); }
      .go { background: #6d28d9; color: #fff; padding: 7px 12px; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
      .go:disabled { opacity: .6; cursor: default; }
      .x { background: #fff; color: #444; width: 28px; }
      .note { max-width: 260px; background: #fff; color: #1f1f23; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; padding: 8px 10px; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
      .note[hidden] { display: none; }
    </style>
    <div class="wrap">
      <div class="note" role="status" aria-live="polite" hidden></div>
      <div class="row">
        <button class="go" type="button" title="Send this page's text to Pranan to suggest what to remember">Remember this page</button>
        <button class="x" type="button" aria-label="Hide for this page">&times;</button>
      </div>
    </div>`;
  const go = root.querySelector<HTMLButtonElement>('.go')!;
  const hide = root.querySelector<HTMLButtonElement>('.x')!;
  const note = root.querySelector<HTMLDivElement>('.note')!;
  const show = (text: string) => { note.textContent = text; note.hidden = false; };

  hide.addEventListener('click', () => host.remove());
  go.addEventListener('click', async () => {
    if (looksLikeLoginPage()) { show('Pranan does not read sign-in or payment pages.'); return; }
    const text = pageText();
    if (text.length < MIN_PAGE_TEXT) { show('There is not enough text on this page to learn from.'); return; }
    go.disabled = true;
    go.textContent = 'Reading...';
    let reply: LearnReply | undefined;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'LEARN_PAGE', payload: { url: location.href, title: document.title.slice(0, 300), text } });
    } catch {
      reply = undefined;
    }
    go.disabled = false;
    go.textContent = 'Remember this page';
    show(message(reply));
  });
  document.documentElement.appendChild(host);
}

if (window.top === window && claimContentScriptInstance('learn') && !looksLikeLoginPage()) {
  mount();
}
