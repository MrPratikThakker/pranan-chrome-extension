/**
 * Token-refresh centralization (2026-06-09).
 *
 * Refresh tokens are single-use and rotate server-side, so only the service
 * worker may call POST /api/companion/refresh. Every other context (popup,
 * side panel) must delegate to the SW via a REFRESH_TOKEN message and then
 * re-read the freshly-persisted token. These tests pin that contract so a
 * future change can't reintroduce the popup-vs-SW refresh race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Store = Record<string, unknown>;
let store: Store = {};

function makeJwt(expEpochSec: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expEpochSec })).toString('base64');
  return `h.${payload}.s`;
}

function okJson(body: unknown) {
  return {
    status: 200,
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  store = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Store = {};
          for (const k of list) if (store[k] !== undefined) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (obj: Store) => { Object.assign(store, obj); }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        }),
      },
    },
    runtime: { sendMessage: vi.fn(async () => ({ ok: true })) },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.resetModules();
});

const nowSec = () => Math.floor(Date.now() / 1000);
const hitRefresh = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.some((c) => String(c[0]).includes('/companion/refresh'));

describe('token refresh centralization', () => {
  it('non-SW context delegates refresh to the service worker (no direct /refresh)', async () => {
    store.authToken = makeJwt(nowSec() - 10);
    store.refreshToken = 'rt-1';

    const sendMessage = vi.fn(async () => {
      store.authToken = makeJwt(nowSec() + 3600);
      return { ok: true };
    });
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessage;

    const fetchSpy = vi.fn(async () => okJson({ valid: true, userId: 'u1' }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');
    await validateAuth();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'REFRESH_TOKEN' });
    expect(hitRefresh(fetchSpy)).toBe(false);
  });

  it('service-worker context refreshes directly and does not message itself', async () => {
    vi.stubGlobal('window', undefined);
    store.authToken = makeJwt(nowSec() - 10);
    store.refreshToken = 'rt-1';

    const sendMessage = vi.fn(async () => ({ ok: true }));
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = sendMessage;

    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/companion/refresh')) {
        return okJson({ token: makeJwt(nowSec() + 3600), refreshToken: 'rt-2' });
      }
      return okJson({ valid: true, userId: 'u1' });
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { validateAuth } = await import('../src/lib/api-client');
    await validateAuth();

    expect(hitRefresh(fetchSpy)).toBe(true);
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'REFRESH_TOKEN' });
    expect(store.refreshToken).toBe('rt-2');
  });
});
