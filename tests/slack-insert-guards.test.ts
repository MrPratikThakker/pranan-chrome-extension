/**
 * Behavioural tests for Slack insertion (audit EXT-12, EXT-28, EXT-29). The
 * content script is imported for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

vi.mock('@/lib/observability', () => ({ bootstrapSentry: vi.fn(), captureError: vi.fn(), captureMessage: vi.fn(), addBreadcrumb: vi.fn() }));

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
let listener: Listener;
let sendMessage: ReturnType<typeof vi.fn>;
let alive = true;

function deliver(message: unknown): { returned: unknown; response: unknown } {
  let response: unknown;
  const returned = listener(message, {}, (r) => { response = r; });
  return { returned, response };
}

const HREF = 'https://app.slack.com/client/T1/C123';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  alive = true;
  document.body.innerHTML = `
    <div data-qa="channel_name">general</div>
    <div class="c-wysiwyg_container">
      <div data-qa="message_input"><div contenteditable="true" class="ql-editor" data-placeholder="Message">I already typed this</div></div>
    </div>`;
  const env = installChromeStorage();
  sendMessage = vi.fn(async () => ({ ok: true }));
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    runtime: {
      get id() { if (!alive) throw new Error('Extension context invalidated.'); return 'ext'; },
      getManifest: () => ({ version: 'test' }),
      sendMessage,
      onMessage: { addListener: vi.fn((fn: Listener) => { listener = fn; }) },
    },
  };
  Object.defineProperty(location, 'href', { configurable: true, writable: true, value: HREF });
  await import('../src/content/slack/index');
  await vi.advanceTimersByTimeAsync(1_000);
});

afterEach(() => { vi.useRealTimers(); });

const input = () => document.querySelector<HTMLElement>('[data-qa="message_input"] [contenteditable="true"]')!;

describe('Slack insert guards', () => {
  it('refuses a draft generated for a different conversation', () => {
    const { response } = deliver({ type: 'INSERT_DRAFT', payload: { text: 'Draft for channel A', originUrl: 'https://app.slack.com/client/T1/C999' } });
    expect(response).toMatchObject({ success: false, reason: 'conversation_changed' });
    expect(input().textContent).toBe('I already typed this');
  });

  it('inserts for the same conversation and offers to undo the replaced text', () => {
    const { response } = deliver({ type: 'INSERT_DRAFT', payload: { text: 'New draft', originUrl: HREF } });
    expect(response).toMatchObject({ success: true });
    expect(input().textContent).toContain('New draft');
    const undo = document.querySelector<HTMLElement>('[data-pranan-slack-undo] button')!;
    expect(undo).toBeTruthy();
    undo.click();
    expect(input().textContent).toContain('I already typed this');
  });

  it('does not claim messages it never answers (EXT-28)', () => {
    expect(deliver({ type: 'SOMETHING_ELSE' }).returned).toBe(false);
  });

  it('does not sit on "Drafting..." when the extension is gone (EXT-29)', async () => {
    const bar = document.querySelector('[data-pranan-slack-bar]');
    expect(bar).toBeTruthy();
    const barInput = bar!.querySelector('input')!;
    const generate = Array.from(bar!.querySelectorAll('button')).find((b) => /Generate/.test(b.textContent || ''))!;
    barInput.value = 'say yes';
    alive = false;
    generate.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(generate.textContent).toBe('Generate');
    expect(barInput.disabled).toBe(false);
    expect(barInput.value).toBe('say yes');
  });

  it('gives up after the timeout if no reply ever arrives (EXT-29)', async () => {
    const bar = document.querySelector('[data-pranan-slack-bar]')!;
    const barInput = bar.querySelector('input')!;
    const generate = Array.from(bar.querySelectorAll('button')).find((b) => /Generate/.test(b.textContent || ''))!;
    barInput.value = 'say yes';
    generate.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(generate.textContent).toBe('Drafting...');
    await vi.advanceTimersByTimeAsync(30_001);
    expect(generate.textContent).toBe('Generate');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_INLINE_DRAFT' }));
  });
});
