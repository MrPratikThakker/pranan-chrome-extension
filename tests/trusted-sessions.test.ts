import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let originalFetch: typeof globalThis.fetch;
let storage: Record<string, string>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  storage = {
    authToken: `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.y`,
    refreshToken: 'refresh',
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: Record<string, string>) => Object.assign(storage, value)),
        remove: vi.fn(async (keys: string[]) => keys.forEach((key) => delete storage[key])),
      },
    },
    runtime: { sendMessage: vi.fn(async () => null), lastError: undefined },
    tabs: { create: vi.fn() },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('trusted session companion contract', () => {
  it('sends the independent bearer token when listing sessions', async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const { getActiveSessions } = await import('../src/lib/api-client');
    await expect(getActiveSessions()).resolves.toEqual([]);
    expect(new Headers(captured?.headers).get('Authorization')).toBe(`Bearer ${storage.authToken}`);
  });

  it('keeps reauthentication distinct from revocation failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'reauthentication_required' }), { status: 428 })) as typeof globalThis.fetch;
    const { revokeActiveSession } = await import('../src/lib/api-client');
    await expect(revokeActiveSession('all')).resolves.toBe('reauth');
  });

  it('clears both access and refresh tokens on side-panel logout', () => {
    const store = readFileSync(resolve(process.cwd(), 'src/hooks/useStore.ts'), 'utf8');
    expect(store).toContain("remove(['authToken', 'refreshToken', 'lastKnownAuthValid'])");
  });

  it('offers current, individual, and all-device controls in the companion UI', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/SessionsPanel.tsx'), 'utf8');
    expect(panel).toContain("revokeActiveSession(session.current ? 'current' : 'revoke'");
    expect(panel).toContain("revokeActiveSession('all')");
    expect(panel).toContain('Active Sessions');
  });
});
