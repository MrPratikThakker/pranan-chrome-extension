/**
 * Audit EXT-10: tokens must not live in chrome.storage.local, which every
 * content script can read. They live in chrome.storage.session (trusted
 * contexts only) with a persisted copy in the extension origin's IndexedDB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

let env: ReturnType<typeof installChromeStorage>;

beforeEach(() => {
  env = installChromeStorage();
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: env.storage };
});

afterEach(() => { vi.resetModules(); });

describe('token store', () => {
  it('writes tokens to trusted session storage, never to local', async () => {
    const { writeAuthTokens, readAuthTokens } = await import('../src/lib/token-store');
    await writeAuthTokens({ authToken: 'a1', refreshToken: 'r1' });
    expect(env.session.data).toEqual({ authToken: 'a1', refreshToken: 'r1' });
    expect(env.local.data).toEqual({});
    await expect(readAuthTokens()).resolves.toEqual({ authToken: 'a1', refreshToken: 'r1' });
  });

  it('moves a legacy chrome.storage.local copy into trusted storage and deletes it', async () => {
    env.local.data.authToken = 'old-a';
    env.local.data.refreshToken = 'old-r';
    env.local.data.lastKnownAuthValid = true;
    const { readAuthTokens } = await import('../src/lib/token-store');
    await expect(readAuthTokens()).resolves.toEqual({ authToken: 'old-a', refreshToken: 'old-r' });
    expect(env.session.data).toEqual({ authToken: 'old-a', refreshToken: 'old-r' });
    expect(env.local.data).toEqual({ lastKnownAuthValid: true });
  });

  it('keeps the legacy copy when no trusted store is available, so the session is not lost', async () => {
    (globalThis as unknown as { chrome: { storage: { session?: unknown } } }).chrome.storage.session = undefined;
    env.local.data.authToken = 'old-a';
    const { readAuthTokens } = await import('../src/lib/token-store');
    await expect(readAuthTokens()).resolves.toEqual({ authToken: 'old-a', refreshToken: null });
    expect(env.local.data.authToken).toBe('old-a');
  });

  it('a re-auth without a refresh token removes the stale one', async () => {
    const { writeAuthTokens } = await import('../src/lib/token-store');
    await writeAuthTokens({ authToken: 'a1', refreshToken: 'r1' });
    await writeAuthTokens({ authToken: 'a2', refreshToken: null });
    expect(env.session.data).toEqual({ authToken: 'a2' });
  });

  it('clearAuthTokens removes both tokens from every store', async () => {
    env.local.data.authToken = 'legacy';
    const { writeAuthTokens, clearAuthTokens, readAuthTokens } = await import('../src/lib/token-store');
    await writeAuthTokens({ authToken: 'a1', refreshToken: 'r1' });
    await clearAuthTokens();
    expect(env.session.data).toEqual({});
    expect(env.local.data).toEqual({});
    await expect(readAuthTokens()).resolves.toEqual({ authToken: null, refreshToken: null });
  });

  it('restricts session storage to trusted contexts when the browser supports it', async () => {
    const setAccessLevel = vi.fn(async () => {});
    (env.storage.session as unknown as { setAccessLevel: unknown }).setAccessLevel = setAccessLevel;
    const { restrictTokenStorageToTrustedContexts } = await import('../src/lib/token-store');
    await restrictTokenStorageToTrustedContexts();
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });
});

describe('content scripts never touch the API client or tokens', () => {
  it('no content script imports the api client or the token store', async () => {
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const offenders = walk(join(process.cwd(), 'src/content'))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => /lib\/(api-client|token-store)'/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
