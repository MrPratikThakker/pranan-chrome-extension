/**
 * Behavioural tests for the service worker's message routing (audit EXT-33).
 * The worker is imported for real with the API client mocked, and messages
 * are driven through its registered listeners.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

const api = vi.hoisted(() => ({
  validateAuth: vi.fn(),
  getContactContext: vi.fn(),
  generateDraft: vi.fn(),
  checkGrammar: vi.fn(),
  getReplyIntents: vi.fn(),
  setTierOverride: vi.fn(),
  refreshAccessTokenWithOutcome: vi.fn(),
  postVoiceExemplar: vi.fn(),
  transcribeAudio: vi.fn(),
  exchangeLoginNonce: vi.fn(),
  setAuthExpiredHandler: vi.fn(),
}));
vi.mock('@/lib/api-client', () => api);
vi.mock('@/lib/observability', () => ({ bootstrapSentry: vi.fn(), captureError: vi.fn(), captureMessage: vi.fn(), addBreadcrumb: vi.fn() }));

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => unknown;

const ID = 'ext-id';
let env: ReturnType<typeof installChromeStorage>;
let onMessage: Listener;
let onExternal: Listener;
let tabMessages: Array<{ tabId: number; message: { type: string; payload: Record<string, unknown> } }>;

const gmailTab = { id: 7, url: 'https://mail.google.com/mail/u/0/#inbox/abc' } as chrome.tabs.Tab;
const gmailSender = { id: ID, tab: gmailTab, url: gmailTab.url } as chrome.runtime.MessageSender;
const linkedinTab = { id: 8, url: 'https://www.linkedin.com/feed/' } as chrome.tabs.Tab;
const linkedinSender = { id: ID, tab: linkedinTab, url: linkedinTab.url } as chrome.runtime.MessageSender;
const appSender = { id: ID, tab: { id: 9 } as chrome.tabs.Tab, url: 'https://app.pranan.ai/auth/companion-callback', origin: 'https://app.pranan.ai' } as chrome.runtime.MessageSender;
const panelSender = { id: ID, url: `chrome-extension://${ID}/sidepanel.html` } as chrome.runtime.MessageSender;

function send(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  return new Promise((resolve) => { onMessage(message, sender, resolve); });
}
function sendExternal(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const keepOpen = onExternal(message, { origin: 'https://app.pranan.ai' } as chrome.runtime.MessageSender, resolve);
    if (keepOpen !== true) setTimeout(() => resolve('no-response'), 0);
  });
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.resetModules();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.validateAuth.mockResolvedValue({ valid: true, userId: 'u1' });
  env = installChromeStorage();
  tabMessages = [];
  const noopEvent = { addListener: vi.fn() };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    runtime: {
      id: ID,
      getManifest: () => ({ version: '0.8.68' }),
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn((fn: Listener) => { onMessage = fn; }) },
      onMessageExternal: { addListener: vi.fn((fn: Listener) => { onExternal = fn; }) },
      onStartup: noopEvent,
      onInstalled: noopEvent,
    },
    alarms: { create: vi.fn(), get: vi.fn((_n: string, cb: (a: unknown) => void) => cb({})), onAlarm: noopEvent },
    tabs: {
      sendMessage: vi.fn(async (tabId: number, message: { type: string; payload: Record<string, unknown> }) => { tabMessages.push({ tabId, message }); }),
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      get: vi.fn(),
      onActivated: noopEvent,
      onUpdated: noopEvent,
    },
    sidePanel: { open: vi.fn(async () => {}), setOptions: vi.fn(async () => {}) },
    commands: { onCommand: noopEvent },
    webNavigation: { onHistoryStateUpdated: noopEvent },
  };
  await import('../src/background/service-worker');
  await flush();
});

afterEach(() => { vi.useRealTimers(); });

describe('draft routing (EXT-01, EXT-16)', () => {
  it('the Gmail compose popover drafts in the worker and inserts with its correlation ids', async () => {
    api.generateDraft.mockResolvedValue({ draft: 'Happy to decline.', confidence: 1, voiceMatch: 1, alternativeTones: [] });
    await send({ type: 'INLINE_DRAFT_REQUEST', payload: { originSurface: 'compose-toolbar', platform: 'gmail', requestId: 'r1', editorId: 'e1', userPrompt: 'decline politely', tone: 'warm', currentDraft: 'Hi' } }, gmailSender);
    await flush();
    expect(api.generateDraft).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'decline politely', tone: 'warm', currentDraft: 'Hi', platform: 'gmail' }), expect.any(AbortSignal));
    expect(tabMessages).toEqual([{ tabId: 7, message: { type: 'INSERT_DRAFT', payload: { text: 'Happy to decline.', originUrl: gmailTab.url, editorId: 'e1', requestId: 'r1' } } }]);
  });

  it('forwards text already typed in Slack as the current draft (EXT-12)', async () => {
    api.generateDraft.mockResolvedValue({ draft: 'ok' });
    await send({ type: 'INLINE_DRAFT_REQUEST', payload: { originSurface: 'inline-bar', platform: 'slack', currentText: 'half a message' } }, { ...gmailSender, tab: { id: 3, url: 'https://app.slack.com/client/T/C' } as chrome.tabs.Tab });
    await flush();
    expect(api.generateDraft).toHaveBeenCalledWith(expect.objectContaining({ currentDraft: 'half a message' }), expect.any(AbortSignal));
  });

  it('LinkedIn comment drafts are bounded by a deadline and carry the author URL (EXT-16, XP-25)', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    api.generateDraft.mockImplementation((_req: unknown, s: AbortSignal) => new Promise((_, reject) => {
      signal = s;
      s.addEventListener('abort', () => reject(s.reason));
    }));
    await send({ type: 'COMMENT_DRAFT_REQUEST', payload: { originSurface: 'inline-bar', platform: 'linkedin', postAuthorUrl: 'https://www.linkedin.com/in/sam', requestId: 'c1', editorId: 'ce1' } }, linkedinSender);
    expect(api.generateDraft).toHaveBeenCalledWith(expect.objectContaining({ postAuthorUrl: 'https://www.linkedin.com/in/sam', composeType: 'comment' }), expect.any(AbortSignal));
    await vi.advanceTimersByTimeAsync(25_001);
    expect(signal?.aborted).toBe(true);
    expect(tabMessages[0].message.type).toBe('DRAFT_SKIPPED');
    expect(tabMessages[0].message.payload).toMatchObject({ requestId: 'c1', editorId: 'ce1', reason: 'error' });
  });
});

describe('opt-in background sends (EXT-02, EXT-03)', () => {
  it('refuses a background grammar check while the switch is off', async () => {
    const reply = await send({ type: 'INLINE_GRAMMAR_CHECK', payload: { text: 'private unsent draft text', platform: 'gmail' } }, gmailSender);
    expect(reply).toEqual({ suggestions: [], disabled: true });
    expect(api.checkGrammar).not.toHaveBeenCalled();
  });

  it('runs the check once the user opts in', async () => {
    env.local.data.privacySettings = { passiveGrammarChecks: true };
    api.checkGrammar.mockResolvedValue({ corrections: [{ range: { start: 0, end: 3 }, original: 'teh', suggestion: 'the', type: 'grammar', reason: 'Spelling' }] });
    const reply = await send({ type: 'INLINE_GRAMMAR_CHECK', payload: { text: 'teh draft', platform: 'gmail', recipientEmail: 'sam@x.com' } }, gmailSender) as { suggestions: unknown[] };
    expect(api.checkGrammar).toHaveBeenCalledWith({ text: 'teh draft', platform: 'gmail', recipientEmail: 'sam@x.com' });
    expect(reply.suggestions).toHaveLength(1);
  });

  it('refuses LinkedIn voice capture while the switch is off, and from other sites', async () => {
    expect(await send({ type: 'CAPTURE_VOICE_EXEMPLAR', payload: { comment: 'A comment long enough to count as a sample.' } }, linkedinSender)).toEqual({ added: false, disabled: true });
    env.local.data.privacySettings = { linkedinVoiceCapture: true };
    expect(await send({ type: 'CAPTURE_VOICE_EXEMPLAR', payload: { comment: 'A comment long enough to count as a sample.' } }, gmailSender)).toEqual({ added: false });
    expect(api.postVoiceExemplar).not.toHaveBeenCalled();
    api.postVoiceExemplar.mockResolvedValue({ added: true });
    expect(await send({ type: 'CAPTURE_VOICE_EXEMPLAR', payload: { comment: 'A comment long enough to count as a sample.' } }, linkedinSender)).toEqual({ added: true });
  });
});

describe('tier correction from Gmail (EXT-17, XP-12)', () => {
  it('accepts a valid tier from the Gmail content script', async () => {
    api.setTierOverride.mockResolvedValue({ ok: true, tier: 'client' });
    expect(await send({ type: 'SET_TIER_OVERRIDE', payload: { email: 'sam@x.com', tier: 'client' } }, gmailSender)).toEqual({ ok: true, tier: 'client' });
  });
  it('rejects an unknown tier, a bad address, and other sites', async () => {
    expect(await send({ type: 'SET_TIER_OVERRIDE', payload: { email: 'sam@x.com', tier: 'partner' } }, gmailSender)).toEqual({ ok: false });
    expect(await send({ type: 'SET_TIER_OVERRIDE', payload: { email: 'not-an-email', tier: 'team' } }, gmailSender)).toEqual({ ok: false });
    expect(await send({ type: 'SET_TIER_OVERRIDE', payload: { email: 'sam@x.com', tier: 'team' } }, linkedinSender)).toEqual({ ok: false });
    expect(api.setTierOverride).not.toHaveBeenCalled();
  });
});

describe('sign-in handoff (EXT-09, EXT-19)', () => {
  it('rejects tokens from the app when the extension did not start a sign-in', async () => {
    const reply = await send({ type: 'AUTH_TOKEN_FROM_WEB', token: 'attacker', refreshToken: 'attacker-rt' }, appSender);
    expect(reply).toMatchObject({ error: expect.stringMatching(/No sign-in was started/) });
    expect(env.session.data.authToken).toBeUndefined();
  });

  it('accepts one handoff for a sign-in the extension started, into trusted storage', async () => {
    env.session.data.pendingCompanionLogin = { state: 's1', startedAt: Date.now() };
    expect(await send({ type: 'AUTH_TOKEN_FROM_WEB', token: 'a1', refreshToken: 'r1' }, appSender)).toEqual({ ok: true });
    expect(env.session.data).toMatchObject({ authToken: 'a1', refreshToken: 'r1' });
    expect(env.local.data.authToken).toBeUndefined();
    expect(await send({ type: 'AUTH_TOKEN_FROM_WEB', token: 'a2', refreshToken: 'r2' }, appSender)).toMatchObject({ error: expect.any(String) });
    expect(env.session.data.authToken).toBe('a1');
  });

  it('exchanges a one-time nonce itself so tokens never pass through the page', async () => {
    env.session.data.pendingCompanionLogin = { state: 's1', startedAt: Date.now() };
    api.exchangeLoginNonce.mockResolvedValue({ token: 'a-nonce', refreshToken: 'r-nonce' });
    expect(await send({ type: 'AUTH_TOKEN_FROM_WEB', nonce: 'f'.repeat(64), state: 's1' }, appSender)).toEqual({ ok: true });
    expect(api.exchangeLoginNonce).toHaveBeenCalledWith('f'.repeat(64));
    expect(env.session.data).toMatchObject({ authToken: 'a-nonce', refreshToken: 'r-nonce' });
  });

  it('a failed validation keeps the sign-in open for a retry', async () => {
    env.session.data.pendingCompanionLogin = { state: 's1', startedAt: Date.now() };
    api.validateAuth.mockResolvedValueOnce({ valid: false });
    expect(await send({ type: 'AUTH_TOKEN_FROM_WEB', token: 'bad', refreshToken: 'bad-r' }, appSender)).toEqual({ error: 'Token invalid' });
    expect(env.session.data.authToken).toBeUndefined();
    expect(await send({ type: 'AUTH_TOKEN_FROM_WEB', token: 'a1', refreshToken: 'r1' }, appSender)).toEqual({ ok: true });
  });

  it('rejects the handoff from a non-app page', async () => {
    env.session.data.pendingCompanionLogin = { state: 's1', startedAt: Date.now() };
    expect(await send({ type: 'AUTH_TOKEN_FROM_WEB', token: 'a1', refreshToken: 'r1' }, gmailSender)).toEqual({ error: 'Untrusted sender' });
  });

  it('external AUTH_TOKEN requires a refresh token and always answers', async () => {
    env.session.data.pendingCompanionLogin = { state: 's1', startedAt: Date.now() };
    expect(await sendExternal({ type: 'AUTH_TOKEN', token: 'a1' })).toEqual({ error: 'Refresh token required' });
    expect(await sendExternal({ type: 'SOMETHING_ELSE' })).toEqual({ error: 'Unknown message type' });
    expect(await sendExternal({ type: 'AUTH_TOKEN', token: 'a1', refreshToken: 'r1' })).toEqual({ ok: true });
  });
});

describe('voice transcription for content scripts (EXT-07)', () => {
  it('transcribes audio sent from a tab', async () => {
    api.transcribeAudio.mockResolvedValue('Confirm Friday.');
    expect(await send({ type: 'TRANSCRIBE_AUDIO', payload: { audio: btoa('voice'), mimeType: 'audio/webm' } }, gmailSender)).toEqual({ text: 'Confirm Friday.' });
    const blob = api.transcribeAudio.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('audio/webm');
  });
});

describe('sign-out paths (EXT-23, EXT-24)', () => {
  it('DISCONNECT clears tokens and the cached auth, but only from a trusted page', async () => {
    env.session.data.authToken = 'a1';
    env.session.data.refreshToken = 'r1';
    expect(await send({ type: 'DISCONNECT' }, gmailSender)).toEqual({ ok: false });
    expect(env.session.data.authToken).toBe('a1');
    expect(await send({ type: 'DISCONNECT' }, panelSender)).toEqual({ ok: true });
    expect(env.session.data.authToken).toBeUndefined();
    expect(env.session.data.authCache).toBeUndefined();
  });

  it('registers a handler so a 401 inside the worker resets its state', () => {
    expect(api.setAuthExpiredHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('reuses a recent confirmed auth result instead of re-validating on every wake (EXT-22)', async () => {
    expect(api.validateAuth).toHaveBeenCalledTimes(1);
    expect(env.session.data.authCache).toMatchObject({ auth: { valid: true } });
    // The worker is torn down and wakes again with the same session storage.
    vi.resetModules();
    await import('../src/background/service-worker');
    await flush();
    expect(api.validateAuth).toHaveBeenCalledTimes(1);
    // A stale cache is re-checked.
    (env.session.data.authCache as { ts: number }).ts = Date.now() - 11 * 60 * 1000;
    vi.resetModules();
    await import('../src/background/service-worker');
    await flush();
    expect(api.validateAuth).toHaveBeenCalledTimes(2);
  });
});
