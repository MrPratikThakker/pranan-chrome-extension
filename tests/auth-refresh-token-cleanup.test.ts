/**
 * Refresh-token storage normalization (audit LOW).
 *
 * A re-auth or a validation failure must never leave a STALE refresh token
 * behind. On the auth-expiry (401) path the extension previously cleared only
 * authToken, leaving a dead refreshToken the refresh path kept retrying.
 * notifyAuthExpired must now clear BOTH tokens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let originalFetch: typeof globalThis.fetch;
let removeCalls: unknown[][] = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  removeCalls = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async (keys: unknown) => { removeCalls.push([keys]); }),
      },
    },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()), lastError: undefined },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('auth-expiry clears both tokens', () => {
  it('removes authToken AND refreshToken on a 401 response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"error":"Unauthorized"}', { status: 401 })
    ) as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');
    // validateAuth swallows the thrown ApiError into { valid:false }, but the
    // 401 path still runs notifyAuthExpired first.
    await validateAuth().catch(() => {});

    const flat = removeCalls.flat(2);
    expect(flat).toContain('authToken');
    expect(flat).toContain('refreshToken');
  });
});
