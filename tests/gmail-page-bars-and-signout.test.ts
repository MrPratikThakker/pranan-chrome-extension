/**
 * Audit 17 Oct 2026, Gmail and the sign-out popup.
 *
 * The Gmail bars need a live Gmail DOM end to end, so they are checked as
 * source contracts, like gmail-surface-contracts. The saved list they use is
 * tested in page-bar-prefs. The sign-out badge is tested for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { stripComments } from './helpers/strip-comments';

const gmail = stripComments(readFileSync('src/content/gmail/index.ts', 'utf8'));
const worker = stripComments(readFileSync('src/background/service-worker.ts', 'utf8'));

const section = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));

describe('Gmail prompt under emails', () => {
  const bar = section(gmail, 'function injectThreadPromptBar', 'function findThreadViews');

  it('is skipped once the user has hidden it', () => {
    expect(bar).toMatch(/^function injectThreadPromptBar\(threadContainer: Element\) \{\s*if \(pageBars\.isHidden\('gmailThread'\)\) return;/);
  });

  it('has an x that hides it under every email', () => {
    expect(bar).toContain("close.setAttribute('aria-label', 'Hide under emails')");
    expect(bar).toContain("dismissPageBar('gmailThread', bar, pageBars)");
    expect(bar).toContain('bar.appendChild(close)');
  });
});

describe('Gmail compose bar', () => {
  const rail = section(gmail, 'function injectAutomaticComposeRail', 'function composeUsesDarkTheme');

  it('is skipped once hidden in every email; the toolbar icon is not', () => {
    expect(rail).toMatch(/^function injectAutomaticComposeRail\([^)]*\) \{\s*if \(pageBars\.isHidden\('gmailCompose'\)\) return;/);
    const buttons = section(gmail, 'function injectComposeButtons', 'function positionComposeBar');
    expect(buttons).toContain('injectFloatingIcon(composeWindow, recipientEmail)');
    expect(section(gmail, 'function injectFloatingIcon', 'function mountPrananToolbarButton')).not.toContain('isHidden');
  });

  it('asks whether to hide it for this email or in every email', () => {
    expect(rail).toContain('>For this email</button>');
    expect(rail).toContain('>In every email</button>');
    expect(rail).toContain('>Cancel</button>');
    expect(rail).toContain("composeWindow.setAttribute(PRANAN_COMPOSE_RAIL_DISMISSED_ATTR, 'true')");
    expect(rail).toContain("dismissPageBar('gmailCompose', host, pageBars)");
    expect(rail).toContain('.rail[hidden] { display: none; }');
  });

  it('waits for the hidden list before drawing anything', () => {
    const init = gmail.slice(gmail.indexOf('async function init()'));
    expect(init.indexOf('await pageBars.ready')).toBeGreaterThan(-1);
    expect(init.indexOf('await pageBars.ready')).toBeLessThan(init.indexOf('rootObserver.observe('));
  });
});

describe('session expiry', () => {
  it('no longer opens the toolbar popup by itself', () => {
    expect(worker).not.toContain('openPopup');
    const expired = section(worker, "case 'AUTH_EXPIRED': {", "case 'SIDE_PANEL_READY': {");
    expect(expired).toContain('await showSignedOutBadge()');
  });

  it('clears the badge on the next good sign-in check', () => {
    const validate = section(worker, 'async function deduplicatedValidateAuth', 'async function initAuth');
    expect(validate).toContain('if (auth.valid) void clearSignedOutBadge()');
  });
});

describe('signed-out badge', () => {
  let action: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    action = {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setTitle: vi.fn(async () => {}),
    };
    (globalThis as unknown as { chrome: unknown }).chrome = { action };
  });
  afterEach(() => { vi.resetModules(); });

  it('shows "!" with a tooltip that says why, and clears both', async () => {
    const { showSignedOutBadge, clearSignedOutBadge } = await import('../src/background/signed-out-badge');
    await showSignedOutBadge();
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
    expect(action.setTitle).toHaveBeenLastCalledWith({ title: 'Pranan for Chrome: signed out. Click to sign in again.' });
    await clearSignedOutBadge();
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(action.setTitle).toHaveBeenLastCalledWith({ title: 'Pranan for Chrome' });
  });

  it('does not throw where the action API is missing', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {};
    const { showSignedOutBadge, clearSignedOutBadge } = await import('../src/background/signed-out-badge');
    await expect(showSignedOutBadge()).resolves.toBeUndefined();
    await expect(clearSignedOutBadge()).resolves.toBeUndefined();
  });
});
