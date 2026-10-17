/**
 * The LinkedIn message bar keeps the user's instruction until a draft lands
 * (audit EXT-30, EXT-16). The content script is imported for real.
 *
 * Kept in its own file: LinkedIn has no single-instance guard, so copies of
 * the script imported by earlier tests in the same file keep their document
 * listeners, and the message bar is now built on focus by whichever copy's
 * timer fires first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

vi.mock('@/lib/observability', () => ({ bootstrapSentry: vi.fn(), captureError: vi.fn(), captureMessage: vi.fn(), addBreadcrumb: vi.fn() }));

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
let listener: Listener;
let sent: Array<{ type: string; payload?: Record<string, unknown> }>;

function deliver(message: unknown): { returned: unknown; response: unknown } {
  let response: unknown;
  const returned = listener(message, {}, (r) => { response = r; });
  return { returned, response };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  sent = [];
  document.body.innerHTML = `
    <div class="msg-form">
      <div class="msg-form__contenteditable" contenteditable="true" role="textbox">Typed DM text</div>
    </div>
    <div class="feed">
      <div data-testid="ui-core-tiptap-text-editor-wrapper">
        <div contenteditable="true" aria-label="Text editor for creating comment">My public comment</div>
      </div>
    </div>`;
  const env = installChromeStorage();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    runtime: {
      id: 'ext',
      getManifest: () => ({ version: 'test' }),
      sendMessage: vi.fn(async (msg: { type: string; payload?: Record<string, unknown> }) => { sent.push(msg); return { ok: true }; }),
      onMessage: { addListener: vi.fn((fn: Listener) => { listener = fn; }) },
    },
  };
  Object.defineProperty(location, 'href', { configurable: true, writable: true, value: 'https://www.linkedin.com/messaging/thread/1/' });
  await import('../src/content/linkedin/index');
  await vi.advanceTimersByTimeAsync(600);
});

afterEach(() => { vi.useRealTimers(); });

const messageEditor = () => document.querySelector<HTMLElement>('.msg-form__contenteditable')!;

describe('LinkedIn prompt bar keeps the instruction until a draft lands (EXT-30, EXT-16)', () => {
  // The message bar appears once the user is in the message box (audit 17 Oct 2026).
  beforeEach(async () => {
    messageEditor().focus();
    await vi.advanceTimersByTimeAsync(600);
  });

  it('keeps the prompt on failure, ignores stale replies, clears it on success', async () => {
    const bar = document.querySelector('[data-pranan-li-msg-bar]');
    expect(bar).toBeTruthy();
    const input = bar!.querySelector('input')!;
    const generate = bar!.querySelector<HTMLButtonElement>('[data-pranan-generate]')!;

    input.value = 'decline politely';
    generate.click();
    await vi.advanceTimersByTimeAsync(0);
    const first = sent.find((m) => m.type === 'INLINE_DRAFT_REQUEST')!;
    expect(first.payload).toMatchObject({ prompt: 'decline politely', editorId: messageEditor().getAttribute('data-pranan-editor-id') });
    expect(input.value).toBe('decline politely');

    deliver({ type: 'DRAFT_SKIPPED', payload: { requestId: first.payload!.requestId, message: 'Rate limited' } });
    expect(input.value).toBe('decline politely');

    generate.click();
    await vi.advanceTimersByTimeAsync(0);
    const second = sent.filter((m) => m.type === 'INLINE_DRAFT_REQUEST')[1];
    // A late reply for the first request must not land.
    const stale = deliver({ type: 'INSERT_DRAFT', payload: { text: 'Late draft', editorId: first.payload!.editorId, requestId: first.payload!.requestId } });
    expect(stale.response).toMatchObject({ success: false, reason: 'request_expired' });
    expect(messageEditor().textContent).toBe('Typed DM text');

    const ok = deliver({ type: 'INSERT_DRAFT', payload: { text: 'Thanks, but I will pass.', editorId: second.payload!.editorId, requestId: second.payload!.requestId } });
    expect(ok.response).toMatchObject({ success: true });
    expect(input.value).toBe('');
  });
});
