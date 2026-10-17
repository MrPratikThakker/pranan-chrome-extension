/**
 * Behavioural tests for LinkedIn draft insertion (audit EXT-11, EXT-16,
 * EXT-28, EXT-30). The content script is imported for real.
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
const commentEditor = () => document.querySelector<HTMLElement>('[aria-label="Text editor for creating comment"]')!;

describe('LinkedIn insert binding', () => {
  it('puts a bound message draft in the message editor even when a comment box has focus', () => {
    const editorId = messageEditor().getAttribute('data-pranan-editor-id');
    expect(editorId).toBeTruthy();
    commentEditor().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const { response } = deliver({ type: 'INSERT_DRAFT', payload: { text: 'Private DM draft', editorId } });
    expect(response).toMatchObject({ success: true });
    expect(messageEditor().textContent).toContain('Private DM draft');
    expect(commentEditor().textContent).toBe('My public comment');
  });

  it('refuses a bound draft whose editor is gone instead of using another one', () => {
    const { response } = deliver({ type: 'INSERT_DRAFT', payload: { text: 'Private DM draft', editorId: 'missing-editor' } });
    expect(response).toMatchObject({ success: false, reason: 'editor_changed' });
    expect(messageEditor().textContent).toBe('Typed DM text');
    expect(commentEditor().textContent).toBe('My public comment');
  });

  it('does not claim messages it never answers (EXT-28)', () => {
    expect(deliver({ type: 'SOMETHING_ELSE' }).returned).toBe(false);
  });
});
