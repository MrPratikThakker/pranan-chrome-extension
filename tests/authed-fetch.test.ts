/**
 * Verify the credentials-passthrough behavior of authedFetch (v0.4.0+).
 *
 * The whole point of this rewrite is that fetches MUST send
 * `credentials: 'include'` so the browser attaches the user's Supabase
 * auth cookie. Without that, we're back to the token-handshake loop.
 *
 * We can't directly call authedFetch (it's module-private) but we can
 * verify the behavior indirectly through the public API that uses it.
 * We test via global fetch mock, asserting credentials:'include' on every
 * outbound call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let originalFetch: typeof globalThis.fetch;
let chromeStore: { authToken?: string } = {};

function makeFetchSpy(response: Partial<Response> = { status: 200, ok: true }) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    return {
      status: response.status ?? 200,
      ok: response.ok ?? true,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"valid":true,"userId":"u1"}',
      json: async () => ({ valid: true, userId: 'u1' }),
      _capturedInit: init,
    } as unknown as Response;
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  chromeStore = {};
  // Minimal chrome shim
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          const k = Array.isArray(key) ? key[0] : key;
          return k === 'authToken' && chromeStore.authToken
            ? { authToken: chromeStore.authToken }
            : {};
        }),
        remove: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
      },
    },
    runtime: { sendMessage: vi.fn() },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('authedFetch credentials passthrough', () => {
  it('attaches credentials:"include" on validateAuth (no stored token)', async () => {
    const spy = makeFetchSpy();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');
    await validateAuth();

    expect(spy).toHaveBeenCalled();
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    // No legacy token in storage -> no Authorization header
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('attaches both credentials:"include" AND legacy Bearer when token stored', async () => {
    chromeStore.authToken = 'legacy-jwt-token';
    const spy = makeFetchSpy();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');
    await validateAuth();

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer legacy-jwt-token');
  });
});
