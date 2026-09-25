/**
 * Audit EXT-08 / XP-13: a transient refresh failure (429, 5xx, timeout) used
 * to turn into a logout that deleted a refresh token that still worked. Also
 * EXT-22 (offline is not "signed in" without a session), XP-09 (402 and the
 * daily-budget 429 keep their meaning), EXT-06 (nudge routes) and EXT-24 (a
 * 401 in the worker resets the worker's state).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const nowSec = () => Math.floor(Date.now() / 1000);
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64')}.s`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let env: ReturnType<typeof installChromeStorage>;
let sent: Array<{ type: string }>;
let calls: Array<{ url: string; auth: string | null }>;
const originalFetch = globalThis.fetch;

function route(handler: Handler) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    return handler(url, init);
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  env = installChromeStorage();
  sent = [];
  calls = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    runtime: { sendMessage: vi.fn(async (msg: { type: string }) => { sent.push(msg); return undefined; }) },
  };
  // Run as the service worker: it owns refresh.
  vi.stubGlobal('window', undefined);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('refresh failures do not sign the user out', () => {
  it('keeps a valid refresh token when /refresh is rate limited, and never sends the expired token', async () => {
    env.session.data.authToken = jwt(nowSec() - 60);
    env.session.data.refreshToken = 'rt-good';
    route((url) => url.endsWith('/companion/refresh') ? json({ error: 'Too many' }, 429) : json({ valid: true }));
    const { generateDraft } = await import('../src/lib/api-client');
    await expect(generateDraft({ platform: 'gmail' })).rejects.toMatchObject({ status: 503, code: 'AUTH_REFRESH_UNAVAILABLE' });
    expect(env.session.data.refreshToken).toBe('rt-good');
    expect(calls.some((c) => c.url.endsWith('/draft'))).toBe(false);
    expect(sent.find((m) => m.type === 'AUTH_EXPIRED')).toBeUndefined();
  });

  it('keeps the refresh token on a 5xx from /refresh', async () => {
    env.session.data.authToken = jwt(nowSec() - 60);
    env.session.data.refreshToken = 'rt-good';
    route((url) => url.endsWith('/companion/refresh') ? json({ error: 'boom' }, 500) : json({ valid: true }));
    const { refreshAccessTokenWithOutcome } = await import('../src/lib/api-client');
    await expect(refreshAccessTokenWithOutcome()).resolves.toEqual({ token: null, outcome: 'unavailable' });
    expect(env.session.data.refreshToken).toBe('rt-good');
  });

  it('clears both tokens only when /refresh itself answers 401', async () => {
    env.session.data.authToken = jwt(nowSec() - 60);
    env.session.data.refreshToken = 'rt-dead';
    route((url) => url.endsWith('/companion/refresh') ? json({ error: 'Refresh failed' }, 401) : json({ valid: true }));
    const { refreshAccessTokenWithOutcome } = await import('../src/lib/api-client');
    await expect(refreshAccessTokenWithOutcome()).resolves.toEqual({ token: null, outcome: 'rejected' });
    expect(env.session.data).toEqual({});
  });

  it('on a 401 with a live refresh token, refreshes once and retries instead of logging out', async () => {
    env.session.data.authToken = jwt(nowSec() + 3600);
    env.session.data.refreshToken = 'rt-1';
    const fresh = jwt(nowSec() + 7200);
    route((url, init) => {
      if (url.endsWith('/companion/refresh')) return json({ token: fresh, refreshToken: 'rt-2' });
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === `Bearer ${fresh}` ? json({ draft: 'Hi', confidence: 1, voiceMatch: 1, alternativeTones: [] }) : json({ error: 'Unauthorized' }, 401);
    });
    const { generateDraft } = await import('../src/lib/api-client');
    await expect(generateDraft({ platform: 'gmail' })).resolves.toMatchObject({ draft: 'Hi' });
    expect(env.session.data).toEqual({ authToken: fresh, refreshToken: 'rt-2' });
    expect(sent.find((m) => m.type === 'AUTH_EXPIRED')).toBeUndefined();
  });

  it('in the worker, a real 401 resets the worker state through its handler (EXT-24)', async () => {
    env.session.data.authToken = jwt(nowSec() + 3600);
    route((url) => url.endsWith('/companion/refresh') ? json({ error: 'x' }, 401) : json({ error: 'Unauthorized' }, 401));
    const api = await import('../src/lib/api-client');
    const handler = vi.fn();
    api.setAuthExpiredHandler(handler);
    await expect(api.generateDraft({ platform: 'gmail' })).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
    expect(env.session.data).toEqual({});
  });
});

describe('validateAuth offline (EXT-22)', () => {
  it('reports signed out when offline and there was never a session', async () => {
    route(() => { throw new TypeError('Failed to fetch'); });
    const { validateAuth } = await import('../src/lib/api-client');
    await expect(validateAuth()).resolves.toMatchObject({ valid: false, transient: true });
  });

  it('keeps an existing session through a network blip', async () => {
    env.session.data.authToken = jwt(nowSec() + 3600);
    route(() => { throw new TypeError('Failed to fetch'); });
    const { validateAuth } = await import('../src/lib/api-client');
    await expect(validateAuth()).resolves.toMatchObject({ valid: true, transient: true });
  });
});

describe('plan and budget errors keep their meaning (XP-09, XP-31)', () => {
  it('maps a 402 to a quota error with a same-app upgrade link', async () => {
    route(() => json({ error: 'Draft quota exceeded for this billing period', upgrade_url: '/settings/billing' }, 402));
    const { generateDraft } = await import('../src/lib/api-client');
    const err = await generateDraft({ platform: 'gmail' }).catch((e) => e);
    expect(err).toMatchObject({ status: 402, code: 'QUOTA_EXCEEDED', upgradeUrl: 'https://app.pranan.ai/settings/billing' });
  });

  it('never turns a hostile upgrade_url into an off-site link', async () => {
    route(() => json({ error: 'quota', upgrade_url: '//evil.example/pay' }, 402));
    const { generateDraft } = await import('../src/lib/api-client');
    const err = await generateDraft({ platform: 'gmail' }).catch((e) => e);
    expect(err.upgradeUrl).toBe('https://app.pranan.ai/settings/billing');
  });

  it('keeps the daily-budget reason on a 429 instead of "wait a moment"', async () => {
    route(() => json({ error: 'Daily budget exhausted. Free tier resets at midnight UTC.' }, 429));
    const { generateDraft } = await import('../src/lib/api-client');
    const err = await generateDraft({ platform: 'gmail' }).catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: 'DAILY_BUDGET' });
    const { draftErrorMessage } = await import('../src/lib/draft-error-message');
    expect(draftErrorMessage(err)).toMatch(/midnight UTC/);
  });
});

describe('nudge actions (EXT-06 / XP-07)', () => {
  it('encodes the nudge id and surfaces a failed dismissal', async () => {
    route(() => json({ error: 'Not found' }, 404));
    const { dismissNudge } = await import('../src/lib/api-client');
    await expect(dismissNudge('a/b?c')).rejects.toMatchObject({ status: 404 });
    expect(calls[0].url).toBe('https://app.pranan.ai/api/companion/nudges/a%2Fb%3Fc/dismiss');
  });

  it('normalizes a skipped draft from a nudge', async () => {
    route(() => json({ draft: null, skipped: true, reason: 'automated_sender', message: 'Automated sender.' }));
    const { draftFromNudge } = await import('../src/lib/api-client');
    await expect(draftFromNudge('n1')).resolves.toMatchObject({ skipped: true, skipReason: 'automated_sender', skipMessage: 'Automated sender.' });
  });
});
