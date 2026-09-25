/**
 * Audit EXT-09: a sign-in handoff is accepted only for a login the extension
 * started, once, within a short window, and with a matching state if the app
 * echoes one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';
import {
  beginCompanionLogin,
  consumePendingLogin,
  recordPendingLogin,
  restorePendingLogin,
  LOGIN_HANDOFF_WINDOW_MS,
  PENDING_LOGIN_KEY,
} from '../src/lib/login-handoff';

let env: ReturnType<typeof installChromeStorage>;
let created: string[];

beforeEach(() => {
  env = installChromeStorage();
  created = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    tabs: { create: vi.fn(async ({ url }: { url: string }) => { created.push(url); return {}; }) },
  };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('login handoff binding', () => {
  it('Connect records a pending login in trusted storage and opens the companion sign-in', async () => {
    await beginCompanionLogin();
    const pending = env.session.data[PENDING_LOGIN_KEY] as { state: string; startedAt: number };
    expect(pending.state).toMatch(/^[a-f0-9]{32}$/);
    expect(created).toEqual([`https://app.pranan.ai/login?source=companion&ext_state=${pending.state}`]);
    expect(env.local.data[PENDING_LOGIN_KEY]).toBeUndefined();
  });

  it('rejects a handoff nobody started', async () => {
    await expect(consumePendingLogin(undefined)).resolves.toEqual({ ok: false, reason: 'no_pending_login' });
  });

  it('accepts one handoff within the window, then no more', async () => {
    const pending = await recordPendingLogin(1_000);
    await expect(consumePendingLogin(undefined, 2_000)).resolves.toEqual({ ok: true, pending });
    await expect(consumePendingLogin(undefined, 3_000)).resolves.toEqual({ ok: false, reason: 'no_pending_login' });
  });

  it('rejects a handoff after the window', async () => {
    await recordPendingLogin(1_000);
    await expect(consumePendingLogin(undefined, 1_000 + LOGIN_HANDOFF_WINDOW_MS + 1)).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('a wrong state is rejected and does not cancel the real sign-in', async () => {
    const pending = await recordPendingLogin(1_000);
    await expect(consumePendingLogin('attacker-state', 2_000)).resolves.toEqual({ ok: false, reason: 'state_mismatch' });
    await expect(consumePendingLogin(pending.state, 2_500)).resolves.toEqual({ ok: true, pending });
  });

  it('a failed handoff can be retried inside the original window, not beyond it', async () => {
    const pending = await recordPendingLogin(1_000);
    const first = await consumePendingLogin(undefined, 2_000);
    expect(first.ok).toBe(true);
    await restorePendingLogin(pending);
    await expect(consumePendingLogin(undefined, 3_000)).resolves.toEqual({ ok: true, pending });
    await restorePendingLogin(pending);
    await expect(consumePendingLogin(undefined, 1_000 + LOGIN_HANDOFF_WINDOW_MS + 1)).resolves.toEqual({ ok: false, reason: 'expired' });
  });
});
