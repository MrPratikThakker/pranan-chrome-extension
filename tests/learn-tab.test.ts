/**
 * "Remember this page" is a small tab on the right edge, not a pill in the
 * bottom-right corner, and "Hide on this site" is remembered (Pratik,
 * 16 Oct 2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HIDDEN_LEARN_SITES_KEY,
  hiddenHostsForSite,
  hideKeyForHost,
  isLearnButtonHidden,
  learningSiteForHost,
} from '@/lib/work-sites';

describe('hide memory', () => {
  it('keys a page by its host without www', () => {
    expect(hideKeyForHost('WWW.Notion.so')).toBe('notion.so');
    expect(hideKeyForHost('acme.notion.so')).toBe('acme.notion.so');
  });

  it('hides on the host and its subdomains, not on siblings or lookalikes', () => {
    const hidden = ['acme.notion.so'];
    expect(isLearnButtonHidden('acme.notion.so', hidden)).toBe(true);
    expect(isLearnButtonHidden('www.acme.notion.so', hidden)).toBe(true);
    expect(isLearnButtonHidden('docs.acme.notion.so', hidden)).toBe(true);
    expect(isLearnButtonHidden('other.notion.so', hidden)).toBe(false);
    expect(isLearnButtonHidden('notacme.notion.so', hidden)).toBe(false);
  });

  it('maps a page to the site the user added, most specific first', () => {
    const notion = { pattern: 'https://*.notion.so/*', host: 'notion.so' };
    const acme = { pattern: 'https://*.acme.notion.so/*', host: 'acme.notion.so' };
    expect(learningSiteForHost('www.notion.so', [notion])).toEqual(notion);
    expect(learningSiteForHost('team.notion.so', [notion, acme])).toEqual(notion);
    expect(learningSiteForHost('docs.acme.notion.so', [notion, acme])).toEqual(acme);
    expect(learningSiteForHost('notion.so.evil.com', [notion])).toBeNull();
  });

  it('finds the hidden hosts that belong to a learning site', () => {
    const site = { pattern: 'https://*.notion.so/*', host: 'notion.so' };
    expect(hiddenHostsForSite(site, ['acme.notion.so', 'notion.so', 'notion.so.evil.com', 'figma.com'])).toEqual(['acme.notion.so', 'notion.so']);
  });
});

type Store = Record<string, unknown>;

function fakeChrome(store: Store, reply: unknown = { ok: true, suggested: 2 }) {
  return {
    runtime: {
      id: 'test',
      // No worker in this test: HIDE_LEARN_BUTTON goes unanswered, so the tab
      // falls back to saving this page's own host.
      sendMessage: vi.fn(async (msg: { type: string }) => (msg.type === 'HIDE_LEARN_BUTTON' ? undefined : reply)),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Store) => { Object.assign(store, items); }),
      },
    },
  };
}

/** The learn script's shadow root is closed; reach it through attachShadow. */
let lastRoot: ShadowRoot | null = null;
const realAttach = Element.prototype.attachShadow;

async function loadScript(store: Store, reply?: unknown) {
  (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome(store, reply);
  delete (window as unknown as { __prananContentInstances?: unknown }).__prananContentInstances;
  vi.resetModules();
  await import('../src/content/learn/index');
  await vi.waitFor(() => { if (!document.getElementById('pranan-learn-host')) throw new Error('not yet'); }, { timeout: 200 }).catch(() => {});
}

describe('learn tab', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main><p>' + 'We chose the Q4 plan with three launches. '.repeat(5) + '</p></main>';
    lastRoot = null;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      const root = realAttach.call(this, { ...init, mode: 'open' });
      lastRoot = root;
      return root;
    };
  });
  afterEach(() => {
    Element.prototype.attachShadow = realAttach;
    document.getElementById('pranan-learn-host')?.remove();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('sits on the right edge, clear of the bottom-right corner', async () => {
    await loadScript({});
    const host = document.getElementById('pranan-learn-host')!;
    expect(host).toBeTruthy();
    expect(host.style.right).toBe('0px');
    expect(host.style.top).toBe('58%');
    expect(host.style.bottom).toBe('');
    expect(lastRoot!.querySelector('.go')!.getAttribute('aria-label')).toBe('Remember this page');
  });

  it('remembers "Hide on this site" and stays away on the next load', async () => {
    const store: Store = {};
    await loadScript(store);
    lastRoot!.querySelector<HTMLButtonElement>('.hide')!.click();
    expect(document.getElementById('pranan-learn-host')).toBeNull();
    await vi.waitFor(() => expect(store[HIDDEN_LEARN_SITES_KEY]).toEqual([hideKeyForHost(location.hostname)]));

    await loadScript(store);
    expect(document.getElementById('pranan-learn-host')).toBeNull();
  });

  it('still sends the page only on click and shows the result', async () => {
    const store: Store = {};
    await loadScript(store);
    const chromeApi = (globalThis as unknown as { chrome: ReturnType<typeof fakeChrome> }).chrome;
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalled();
    lastRoot!.querySelector<HTMLButtonElement>('.go')!.click();
    await vi.waitFor(() => expect(lastRoot!.querySelector('.note')!.textContent).toContain('2 suggestions'));
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'LEARN_PAGE' }));
  });
});
