/**
 * Audit EXT-17 / XP-12 (Gmail tier correction was always rejected) and
 * EXT-18 (the app-origin check matched by prefix).
 */
import { describe, expect, it } from 'vitest';
import { isOwnContentScript, isTrustedPrivilegedSender, isValidTier } from '../src/background/sender-trust';

const ID = 'extid';
const APP = 'https://app.pranan.ai';
const tab = { id: 1 } as chrome.tabs.Tab;

describe('isTrustedPrivilegedSender', () => {
  it('trusts the extension pages and the app origin exactly', () => {
    expect(isTrustedPrivilegedSender({ id: ID, url: `chrome-extension://${ID}/popup.html` }, ID, APP)).toBe(true);
    expect(isTrustedPrivilegedSender({ id: ID, origin: APP, url: `${APP}/auth/companion-callback`, tab }, ID, APP)).toBe(true);
  });

  it('rejects lookalike hosts that a prefix match accepted', () => {
    expect(isTrustedPrivilegedSender({ id: ID, url: 'https://app.pranan.ai.evil.com/x', tab }, ID, APP)).toBe(false);
    expect(isTrustedPrivilegedSender({ id: ID, url: `chrome-extension://${ID}evil/popup.html` }, ID, APP)).toBe(false);
  });

  it('rejects third-party sites and other extensions', () => {
    expect(isTrustedPrivilegedSender({ id: ID, url: 'https://mail.google.com/mail/u/0/', tab }, ID, APP)).toBe(false);
    expect(isTrustedPrivilegedSender({ id: 'other', url: `chrome-extension://other/popup.html` }, ID, APP)).toBe(false);
  });
});

describe('isOwnContentScript', () => {
  it('accepts this extension\'s Gmail content script', () => {
    expect(isOwnContentScript({ id: ID, url: 'https://mail.google.com/mail/u/0/#inbox', tab }, 'https://mail.google.com', ID)).toBe(true);
  });
  it('rejects other sites, other extensions and non-tab senders', () => {
    expect(isOwnContentScript({ id: ID, url: 'https://mail.google.com.evil.com/', tab }, 'https://mail.google.com', ID)).toBe(false);
    expect(isOwnContentScript({ id: 'other', url: 'https://mail.google.com/', tab }, 'https://mail.google.com', ID)).toBe(false);
    expect(isOwnContentScript({ id: ID, url: 'https://mail.google.com/' }, 'https://mail.google.com', ID)).toBe(false);
  });
});

describe('isValidTier', () => {
  it('accepts only the canonical relationship tiers', () => {
    for (const tier of ['inner_circle', 'team', 'client', 'prospect', 'vendor', 'network']) expect(isValidTier(tier)).toBe(true);
    for (const tier of ['partner', 'investor', '', null, 'TEAM']) expect(isValidTier(tier)).toBe(false);
  });
});
