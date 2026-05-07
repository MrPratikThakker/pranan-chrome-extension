/**
 * Regression test for the auth banner auto-recovery (v0.4.5).
 *
 * Reproduced by Pratik 2026-05-08: side panel showed
 * "Not authenticated. Please reconnect to Pranan." red banner even
 * though cookie auth was working. The sequence:
 *   1. Some API call returns 401 (transient blip)
 *   2. api-client broadcasts AUTH_EXPIRED
 *   3. Side panel sets error = "Not authenticated..."
 *   4. Subsequent calls succeed (cookie was actually fine)
 *   5. BUG: nothing tells the side panel to clear the error
 *
 * Fix: when handleResponse sees a successful response while
 * authExpiryInFlight is true, broadcast AUTH_RECOVERED. The SW
 * re-validates and broadcasts AUTH_STATUS valid:true. useStore
 * clears the error banner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let originalFetch: typeof globalThis.fetch;
let sentMessages: Array<{ type: string }> = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  sentMessages = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
      },
    },
    runtime: {
      sendMessage: vi.fn((msg: { type: string }) => {
        sentMessages.push(msg);
        return Promise.resolve();
      }),
    },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('auth recovery on 401 → 200 transition', () => {
  it('broadcasts AUTH_RECOVERED when a successful response follows a recent 401', async () => {
    // Sequence 1: 401 — fires AUTH_EXPIRED
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('{"error":"Unauthorized"}', { status: 401 });
      }
      return new Response('{"valid":true,"userId":"u1"}', { status: 200 });
    }) as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');

    // First call: 401 → throws ApiError + broadcasts AUTH_EXPIRED
    await expect(validateAuth()).rejects.toThrow();
    expect(sentMessages.find(m => m.type === 'AUTH_EXPIRED')).toBeDefined();
    expect(sentMessages.find(m => m.type === 'AUTH_RECOVERED')).toBeUndefined();

    // Second call: 200 → should broadcast AUTH_RECOVERED because the
    // 5-second authExpiryInFlight window is still open
    await validateAuth();
    expect(sentMessages.find(m => m.type === 'AUTH_RECOVERED')).toBeDefined();
  });

  it('does NOT broadcast AUTH_RECOVERED when there was no recent 401', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"valid":true}', { status: 200 })) as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');
    await validateAuth();

    // Healthy state, no 401 happened — no AUTH_RECOVERED noise
    expect(sentMessages.find(m => m.type === 'AUTH_RECOVERED')).toBeUndefined();
    expect(sentMessages.find(m => m.type === 'AUTH_EXPIRED')).toBeUndefined();
  });
});
