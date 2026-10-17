/**
 * "Remember this page" (Phase 3, see src/lib/work-sites.ts).
 *
 * Registered by the service worker only on sites the user added in the
 * popup. Shows one small tab on the right edge; nothing is read until the
 * user presses it. Then the visible text of this page goes to the service
 * worker, which checks the sender and the site again before sending it to
 * Pranan. Never offered on login or payment pages, or inside frames.
 *
 * It used to be a purple pill fixed in the bottom-right corner of every page,
 * over the site's own chat or cookie buttons, and its x only lasted until the
 * next page (Pratik, 16 Oct 2026). Now it is the Pranan mark, faded, halfway
 * down the right edge; it opens on hover or focus, and "Hide on this site" is
 * remembered for the whole site the user added, until they turn it back on in
 * the popup.
 */
import { claimContentScriptInstance } from '../shared/instance-guard';
import { looksLikeLoginPage, MIN_PAGE_TEXT, pageText } from './page-text';
import { getHiddenLearnHosts, hideLearnButtonOn, isLearnButtonHidden } from '@/lib/work-sites';

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

/** How long a result note stays before it fades. */
const NOTE_MS = 6000;

function mount(): void {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  // Right edge, a little below the middle: clear of the bottom-right corner
  // where sites put chat bubbles, cookie bars and "back to top" buttons.
  host.style.cssText = 'position:fixed;right:0;top:58%;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
      .tab { display: flex; align-items: center; height: 30px; background: #fff; border: 1px solid #e3e0ee; border-right: 0; border-radius: 15px 0 0 15px; box-shadow: 0 1px 4px rgba(20,10,40,.12); opacity: .6; transition: opacity .15s; }
      .tab:hover, .tab:focus-within, .wrap.busy .tab, .wrap.noted .tab { opacity: 1; }
      button { font: inherit; color: #4c1d95; background: none; border: 0; cursor: pointer; height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 6px; }
      button:focus-visible { outline: 2px solid #7c3aed; outline-offset: -2px; border-radius: 15px; }
      .go:disabled { cursor: default; }
      .mark { width: 16px; height: 16px; flex: none; }
      .label, .hide { display: none; }
      .tab:hover .label, .tab:focus-within .label, .wrap.busy .label { display: inline; }
      .tab:hover .hide, .tab:focus-within .hide { display: inline-flex; }
      /* The tab grows to the left. The mark stays at the right end, so it does
         not move out from under the pointer, and Hide opens on the far left,
         away from it: a click on the mark always means Remember. */
      .hide { color: #6b6878; font-weight: 400; border-right: 1px solid #e3e0ee; border-radius: 0; padding: 0 8px 0 10px; height: 18px; }
      .note { max-width: 240px; margin-right: 12px; background: #fff; color: #1f1f23; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; padding: 8px 10px; line-height: 1.4; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
      .note[hidden] { display: none; }
      @media (prefers-reduced-motion: reduce) { .tab { transition: none; } }
    </style>
    <div class="wrap">
      <div class="tab">
        <button class="hide" type="button" title="Turn it back on from the Pranan popup">Hide on this site</button>
        <button class="go" type="button" aria-label="Remember this page" title="Send this page's text to Pranan to suggest what to remember">
          <span class="label">Remember this page</span>
          <svg class="mark" viewBox="0 0 120 120" fill="none" aria-hidden="true"><circle cx="60" cy="60" r="33" stroke="#6d28d9" stroke-width="10"/><circle cx="60" cy="60" r="17" fill="#6d28d9"/></svg>
        </button>
      </div>
      <div class="note" role="status" aria-live="polite" hidden></div>
    </div>`;
  const wrap = root.querySelector<HTMLDivElement>('.wrap')!;
  const go = root.querySelector<HTMLButtonElement>('.go')!;
  const label = root.querySelector<HTMLSpanElement>('.label')!;
  const hide = root.querySelector<HTMLButtonElement>('.hide')!;
  const note = root.querySelector<HTMLDivElement>('.note')!;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  const show = (text: string) => {
    note.textContent = text;
    note.hidden = false;
    wrap.classList.add('noted');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; wrap.classList.remove('noted'); }, NOTE_MS);
  };

  hide.addEventListener('click', async () => {
    host.remove();
    // The worker saves the whole site the user added (notion.so for
    // acme.notion.so). If it cannot be reached, keep at least this page's host.
    let reply: { ok?: boolean } | undefined;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'HIDE_LEARN_BUTTON' });
    } catch {
      reply = undefined;
    }
    if (!reply?.ok) await hideLearnButtonOn(location.hostname).catch(() => {});
  });
  go.addEventListener('click', async () => {
    if (looksLikeLoginPage()) { show('Pranan does not read sign-in or payment pages.'); return; }
    const text = pageText();
    if (text.length < MIN_PAGE_TEXT) { show('There is not enough text on this page to learn from.'); return; }
    go.disabled = true;
    wrap.classList.add('busy');
    label.textContent = 'Reading...';
    let reply: LearnReply | undefined;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'LEARN_PAGE', payload: { url: location.href, title: document.title.slice(0, 300), text } });
    } catch {
      reply = undefined;
    }
    go.disabled = false;
    wrap.classList.remove('busy');
    label.textContent = 'Remember this page';
    show(message(reply));
  });
  document.documentElement.appendChild(host);
}

async function start(): Promise<void> {
  // A failed read must not hide the button for good, so treat it as "not hidden".
  const hidden = await getHiddenLearnHosts().catch(() => [] as string[]);
  if (!isLearnButtonHidden(location.hostname, hidden)) mount();
}

if (window.top === window && claimContentScriptInstance('learn') && !looksLikeLoginPage()) {
  void start();
}
