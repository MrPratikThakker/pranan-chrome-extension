/**
 * Side-panel insert acknowledgement (audit MEDIUM/LOW).
 *
 * The panel's Insert used to be fire-and-forget. sendInsertToActiveTab now
 * resolves a boolean from the content script's sendResponse({ success }) AND
 * chrome.runtime.lastError, so the panel can render "Inserted" vs
 * "Could not insert" (with a Copy fallback). Lock all three outcomes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type SendCb = (resp?: { success?: boolean }) => void;

function installChrome(opts: {
  tabId?: number;
  response?: { success?: boolean };
  lastError?: { message: string } | undefined;
}) {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { lastError: opts.lastError },
    tabs: {
      query: vi.fn((_q: unknown, cb: (tabs: Array<{ id?: number }>) => void) => {
        cb(opts.tabId === undefined ? [{}] : [{ id: opts.tabId }]);
      }),
      sendMessage: vi.fn((_id: number, _msg: unknown, cb: SendCb) => {
        // Chrome sets runtime.lastError right before invoking the callback.
        cb(opts.response);
      }),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe('sendInsertToActiveTab', () => {
  it('resolves true when the content script reports success', async () => {
    installChrome({ tabId: 7, response: { success: true } });
    const { sendInsertToActiveTab } = await import('../src/lib/insert-ack');
    await expect(sendInsertToActiveTab('INSERT_DRAFT', 'hi')).resolves.toBe(true);
  });

  it('resolves false when the content script reports failure (editor_changed / no compose)', async () => {
    installChrome({ tabId: 7, response: { success: false } });
    const { sendInsertToActiveTab } = await import('../src/lib/insert-ack');
    await expect(sendInsertToActiveTab('INSERT_DRAFT', 'hi')).resolves.toBe(false);
  });

  it('resolves false when chrome.runtime.lastError is set (content script gone)', async () => {
    installChrome({ tabId: 7, response: undefined, lastError: { message: 'Could not establish connection' } });
    const { sendInsertToActiveTab } = await import('../src/lib/insert-ack');
    await expect(sendInsertToActiveTab('INSERT_COMMENT_DRAFT', 'hi')).resolves.toBe(false);
  });

  it('resolves false when there is no active tab', async () => {
    installChrome({ tabId: undefined });
    const { sendInsertToActiveTab } = await import('../src/lib/insert-ack');
    await expect(sendInsertToActiveTab('INSERT_DRAFT', 'hi')).resolves.toBe(false);
  });
});
