// "Uncaught Error: Extension context invalidated." — seen in Pratik's
// chrome://extensions error log, 29 Jul, stack at content/gmail.js.
//
// Chrome severs a content script's link to its extension on every reload,
// update or disable, but leaves the injected script running in open tabs. The
// orphaned script keeps handling clicks and throws the moment it touches
// chrome.runtime.
//
// This is not developer-only. It happens to every user on every Chrome Web
// Store auto-update who has Gmail open — for an email assistant, most of them.
// From their side Pranan just stops responding, with nothing explaining why.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isExtensionAlive, safeSendMessage } from '../src/lib/runtime';

declare const globalThis: Record<string, unknown>;

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { delete globalThis.chrome; vi.restoreAllMocks(); });

describe('isExtensionAlive', () => {
  it('is true while the extension is connected', () => {
    globalThis.chrome = { runtime: { id: 'abc123' } };
    expect(isExtensionAlive()).toBe(true);
  });

  it('is false once the context is invalidated', () => {
    // Chrome does not null the object — reading .id throws.
    globalThis.chrome = { runtime: { get id() { throw new Error('Extension context invalidated.'); } } };
    expect(isExtensionAlive()).toBe(false);
  });

  it('is false when chrome is not there at all', () => {
    delete globalThis.chrome;
    expect(isExtensionAlive()).toBe(false);
  });
});

describe('safeSendMessage', () => {
  it('passes the reply through when everything is healthy', async () => {
    globalThis.chrome = { runtime: { id: 'abc', sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
    await expect(safeSendMessage({ type: 'PING' })).resolves.toEqual({ ok: true });
  });

  it('resolves null instead of throwing when the context is dead', async () => {
    // The whole point: 55 call sites across the content scripts, and an
    // uncaught throw in any of them kills whatever the user was doing.
    globalThis.chrome = { runtime: { get id() { throw new Error('Extension context invalidated.'); } } };
    await expect(safeSendMessage({ type: 'PING' })).resolves.toBeNull();
  });

  it('survives a context that dies between the check and the call', async () => {
    let alive = true;
    globalThis.chrome = {
      runtime: {
        get id() { if (!alive) throw new Error('Extension context invalidated.'); return 'abc'; },
        sendMessage: vi.fn(() => { alive = false; throw new Error('Extension context invalidated.'); }),
      },
    };
    await expect(safeSendMessage({ type: 'PING' })).resolves.toBeNull();
  });

  // The "show once" flag is module state, deliberately: once per page load is
  // the production behaviour we want. So these two load a fresh copy of the
  // module rather than relaxing that guard just to make it testable.
  it('tells the user once, not on every click', async () => {
    vi.resetModules();
    globalThis.chrome = { runtime: { get id() { throw new Error('Extension context invalidated.'); } } };
    const { safeSendMessage: fresh } = await import('../src/lib/runtime');
    await fresh({ type: 'A' });
    await fresh({ type: 'B' });
    await fresh({ type: 'C' });
    expect(document.querySelectorAll('[data-pranan-stale]')).toHaveLength(1);
  });

  it('says what happened and offers a way out', async () => {
    vi.resetModules();
    globalThis.chrome = { runtime: { get id() { throw new Error('Extension context invalidated.'); } } };
    const { safeSendMessage: fresh } = await import('../src/lib/runtime');
    await fresh({ type: 'PING' });
    const notice = document.querySelector('[data-pranan-stale]');
    expect(notice?.textContent).toMatch(/reload/i);
    expect(notice?.querySelector('button')).toBeTruthy();
  });
});
