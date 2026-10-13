/**
 * The signed-out state as the Gmail content script sees it.
 *
 * Content scripts cannot read tokens, so everything here goes through
 * messages to the worker. The Gmail DOM wiring itself needs a live Gmail and
 * is covered by source contracts at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { stripComments } from './helpers/strip-comments';
import {
  bindAuthState, getAuthState, isSignedOut, onAuthStateChange, refreshAuthState, requestSignIn,
  resetAuthStateForTests, setAuthState, startAuthStateSync, wireSignInButton, SIGN_IN_LABEL,
} from '../src/content/shared/auth-state';
import { createNoticeActionLink, readNoticeAction } from '../src/content/shared/notice-action';
import { draftErrorAction, draftErrorMessage } from '../src/lib/draft-error-message';

type RuntimeListener = (message: unknown) => unknown;

let sent: Array<{ type?: string }>;
let replies: Record<string, unknown>;
let runtimeListeners: RuntimeListener[];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetAuthStateForTests();
  sent = [];
  replies = {};
  runtimeListeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext-id',
      sendMessage: vi.fn(async (message: { type: string }) => { sent.push(message); return replies[message.type]; }),
      onMessage: { addListener: vi.fn((fn: RuntimeListener) => { runtimeListeners.push(fn); }) },
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('auth state', () => {
  it('starts unknown, which the UI does not treat as signed out', () => {
    expect(getAuthState()).toBe('unknown');
    expect(isSignedOut()).toBe(false);
  });

  it('asks the worker and learns the user is signed out', async () => {
    replies.GET_AUTH_STATE = { signedIn: false };
    expect(await refreshAuthState()).toBe('signed_out');
    expect(isSignedOut()).toBe(true);
    expect(sent).toEqual([{ type: 'GET_AUTH_STATE' }]);
  });

  it('asks the worker and learns the user is signed in', async () => {
    replies.GET_AUTH_STATE = { signedIn: true };
    expect(await refreshAuthState()).toBe('signed_in');
  });

  it('keeps what it knew when the worker cannot tell or does not answer', async () => {
    setAuthState('signed_in');
    replies.GET_AUTH_STATE = { signedIn: null };
    expect(await refreshAuthState()).toBe('signed_in');
    replies.GET_AUTH_STATE = undefined;
    expect(await refreshAuthState()).toBe('signed_in');

    setAuthState('signed_out');
    replies.GET_AUTH_STATE = { signedIn: null };
    expect(await refreshAuthState()).toBe('signed_out');
  });

  it('follows the worker broadcast in both directions without a reload', async () => {
    replies.GET_AUTH_STATE = { signedIn: true };
    startAuthStateSync();
    await flush();
    expect(getAuthState()).toBe('signed_in');
    const seen: string[] = [];
    onAuthStateChange((state) => seen.push(state));

    for (const listener of runtimeListeners) listener({ type: 'AUTH_STATE_CHANGED', payload: { signedIn: false } });
    expect(isSignedOut()).toBe(true);
    for (const listener of runtimeListeners) listener({ type: 'AUTH_STATE_CHANGED', payload: { signedIn: true } });
    expect(getAuthState()).toBe('signed_in');
    expect(seen).toEqual(['signed_out', 'signed_in']);
  });

  it('never keeps the reply channel open for the broadcast (EXT-28)', async () => {
    startAuthStateSync();
    await flush();
    for (const listener of runtimeListeners) {
      expect(listener({ type: 'AUTH_STATE_CHANGED', payload: { signedIn: false } })).toBeUndefined();
      expect(listener({ type: 'INSERT_DRAFT', payload: {} })).toBeUndefined();
    }
  });

  it('ignores a malformed broadcast', async () => {
    replies.GET_AUTH_STATE = { signedIn: true };
    startAuthStateSync();
    await flush();
    for (const listener of runtimeListeners) listener({ type: 'AUTH_STATE_CHANGED', payload: { signedIn: 'no' } });
    for (const listener of runtimeListeners) listener({ type: 'AUTH_STATE_CHANGED' });
    expect(getAuthState()).toBe('signed_in');
  });

  it('asks again when a signed-out tab comes back into view, so returning from sign-in updates Gmail', async () => {
    vi.useFakeTimers();
    replies.GET_AUTH_STATE = { signedIn: false };
    startAuthStateSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(isSignedOut()).toBe(true);
    expect(sent).toHaveLength(1);

    // Straight away: throttled.
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);

    // The user signed in on the other tab and came back.
    replies.GET_AUTH_STATE = { signedIn: true };
    await vi.advanceTimersByTimeAsync(6000);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2);
    expect(getAuthState()).toBe('signed_in');

    // Signed in: focus no longer asks.
    await vi.advanceTimersByTimeAsync(6000);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2);
  });
});

describe('bindAuthState', () => {
  it('applies now and on every change, then stops once its host has left the page', () => {
    const host = document.createElement('div');
    const seen: string[] = [];
    bindAuthState(host, (state) => seen.push(state));
    expect(seen).toEqual(['unknown']);

    // Not attached yet: still bound.
    setAuthState('signed_out');
    document.body.append(host);
    setAuthState('signed_in');
    host.remove();
    setAuthState('signed_out');
    setAuthState('signed_in');
    expect(seen).toEqual(['unknown', 'signed_out', 'signed_in']);
  });
});

describe('the Sign in to Pranan button', () => {
  it('starts the extension sign-in handoff through the worker and says what to do next', async () => {
    replies.BEGIN_COMPANION_LOGIN = { ok: true };
    const button = document.createElement('button');
    const hint = document.createElement('span');
    wireSignInButton(button, hint);
    expect(button.textContent).toBe('Sign in to Pranan');
    expect(button.type).toBe('button');

    button.click();
    expect(button.disabled).toBe(true);
    await flush();
    expect(sent).toEqual([{ type: 'BEGIN_COMPANION_LOGIN' }]);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Sign in to Pranan');
    expect(hint.textContent).toMatch(/finish signing in/i);
  });

  it('does not start two sign-ins from a double click', async () => {
    replies.BEGIN_COMPANION_LOGIN = { ok: true };
    const button = document.createElement('button');
    wireSignInButton(button);
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('points at the toolbar icon when the sign-in page could not be opened', async () => {
    replies.BEGIN_COMPANION_LOGIN = { ok: false };
    const button = document.createElement('button');
    const hint = document.createElement('span');
    wireSignInButton(button, hint);
    button.click();
    await flush();
    expect(hint.textContent).toMatch(/Pranan icon in the Chrome toolbar/);
    expect(await requestSignIn()).toBe(false);
  });

  it('keeps its click away from Gmail', async () => {
    replies.BEGIN_COMPANION_LOGIN = { ok: true };
    const host = document.createElement('div');
    const pageHandler = vi.fn();
    host.addEventListener('click', pageHandler);
    const button = document.createElement('button');
    host.append(button);
    wireSignInButton(button);
    button.click();
    await flush();
    expect(pageHandler).not.toHaveBeenCalled();
  });
});

describe('a 401 mid-session', () => {
  it('reaches Gmail as a sign-in action, not as an address to open', () => {
    const action = draftErrorAction({ status: 401 });
    expect(action).toMatchObject({ kind: 'sign_in', label: 'Sign in to Pranan' });
    expect(action?.message).toMatch(/signed out/i);
    expect(action?.message).not.toMatch(/pranan\.ai/);
  });

  it('no longer tells text-only surfaces to open app.pranan.ai, which does not sign the extension in', () => {
    const text = draftErrorMessage({ status: 401 });
    expect(text).not.toMatch(/open app\.pranan\.ai/i);
    expect(text).toMatch(/Pranan icon in the Chrome toolbar/);
  });

  it('renders as a button that starts sign-in', async () => {
    replies.BEGIN_COMPANION_LOGIN = { ok: true };
    const action = readNoticeAction(draftErrorAction({ status: 401 }))!;
    expect(action.kind).toBe('sign_in');
    const control = createNoticeActionLink(action);
    expect(control.tagName).toBe('BUTTON');
    expect(control.textContent).toBe(SIGN_IN_LABEL);
    control.click();
    await flush();
    expect(sent).toEqual([{ type: 'BEGIN_COMPANION_LOGIN' }]);
  });

  it('never takes the button label from the message', () => {
    expect(readNoticeAction({ kind: 'sign_in', label: 'Click here', message: 'm' })?.label).toBe('Sign in to Pranan');
  });
});

describe('copy rules', () => {
  it('has no em dash or emoji in the new signed-out and upgrade copy', () => {
    const sources = ['src/content/shared/auth-state.ts', 'src/content/shared/notice-action.ts', 'src/lib/draft-error-message.ts']
      .map((file) => readFileSync(file, 'utf8'));
    const strings = sources.flatMap((source) => stripComments(source).match(/'[^'\n]*'|"[^"\n]*"/g) || []);
    for (const literal of strings) {
      expect(literal).not.toMatch(/—/);
      expect(literal).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('Gmail content script wiring (source contracts)', () => {
  const gmail = stripComments(readFileSync('src/content/gmail/index.ts', 'utf8'));
  const slice = (from: string, to: string) => gmail.slice(gmail.indexOf(from), gmail.indexOf(to));

  it('starts the auth sync once, on the primary instance only', () => {
    expect(gmail).toContain('if (IS_PRIMARY_INSTANCE) startAuthStateSync();');
  });

  it('the compose rail swaps its prompt for a sign-in button and back', () => {
    const rail = slice('function injectAutomaticComposeRail', 'function composeUsesDarkTheme');
    expect(rail).toContain('<button class="signin" type="button" hidden>${SIGN_IN_LABEL}</button>');
    expect(rail).toContain('wireSignInButton(signInButton, signInText');
    expect(rail).toContain('bindAuthState(host, () => {');
    expect(rail).toContain('input.hidden = signedOut;');
    expect(rail).toContain('signInButton.hidden = !signedOut;');
  });

  it('the compose popover shows the sign-in state, keeps the typed prompt, and returns to normal', () => {
    const popover = gmail.slice(gmail.indexOf('function openComposePopover'), gmail.indexOf('function escapeText'));
    expect(popover).toContain('data-pranan-signin-button');
    expect(popover).toContain('wireSignInButton(signInButton, signInText);');
    expect(popover).toContain('const stopAuthBinding = bindAuthState(popover, () => {');
    expect(popover).toContain('promptSection.hidden = signedOut;');
    expect(popover).toContain('signInSection.hidden = !signedOut;');
    expect(popover).toContain('stopAuthBinding();');
  });

  it('does not send a draft request while signed out', () => {
    const popover = gmail.slice(gmail.indexOf('function openComposePopover'), gmail.indexOf('function escapeText'));
    const submit = popover.slice(popover.indexOf('const submitFreeformPrompt = async () => {'));
    expect(submit.indexOf('if (isSignedOut()) { signInButton.focus(); return; }')).toBeGreaterThan(-1);
    expect(submit.indexOf('if (isSignedOut())')).toBeLessThan(submit.indexOf("type: 'INLINE_DRAFT_REQUEST'"));
  });

  it('a 401 on a draft puts the popover and the inline bar into the same signed-out state', () => {
    const popover = gmail.slice(gmail.indexOf('function openComposePopover'), gmail.indexOf('function escapeText'));
    expect(popover).toMatch(/if \(action\?\.kind === 'sign_in'\) \{[\s\S]{0,400}setAuthState\('signed_out'\);/);
    const bar = slice('function injectPromptBarV6', 'function injectPromptBarLegacy');
    expect(bar).toContain("if (action?.kind === 'sign_in') setAuthState('signed_out');");
  });

  it('the thread reply bar and the toolbar icon follow the state too', () => {
    const thread = slice('function injectThreadPromptBar', 'function findThreadViews');
    expect(thread).toContain('wireSignInButton(signInBtn, signInText);');
    expect(thread).toContain('bindAuthState(bar, () => {');
    const icon = slice('function mountPrananToolbarButton', 'function injectAutomaticComposeRail');
    expect(icon).toContain("const label = isSignedOut() ? SIGN_IN_LABEL : 'Draft with Pranan';");
  });

  it('does not read tokens or open tabs itself', () => {
    expect(gmail).not.toMatch(/token-store|login-handoff|chrome\.tabs\./);
    const shared = stripComments(readFileSync('src/content/shared/auth-state.ts', 'utf8'));
    expect(shared).not.toMatch(/token-store|login-handoff|chrome\.tabs\.|chrome\.storage/);
  });
});
