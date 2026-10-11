/**
 * Phase 3: sites Pranan can learn from. Only sites the user adds, never
 * mail, chat, sign-in or Pranan itself, and nothing read without a click.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { BUILT_IN_ORIGINS, isLearnablePageUrl, learningSites, siteFromInput } from '@/lib/work-sites';

describe('siteFromInput', () => {
  it('accepts a bare host or an address and covers its subdomains', () => {
    expect(siteFromInput('notion.so')).toEqual({ ok: true, site: { pattern: 'https://*.notion.so/*', host: 'notion.so' } });
    expect(siteFromInput('  https://www.Notion.so/acme/page?x=1 ')).toEqual({ ok: true, site: { pattern: 'https://*.notion.so/*', host: 'notion.so' } });
    expect(siteFromInput('docs.google.com')).toEqual({ ok: true, site: { pattern: 'https://*.docs.google.com/*', host: 'docs.google.com' } });
  });

  it('refuses mail, chat, sign-in and Pranan, including parents that would cover them', () => {
    for (const input of ['mail.google.com', 'google.com', 'accounts.google.com', 'slack.com', 'app.slack.com', 'linkedin.com', 'www.linkedin.com', 'pranan.ai', 'app.pranan.ai', 'office.com', 'outlook.live.com']) {
      expect(siteFromInput(input).ok, input).toBe(false);
    }
  });

  it('refuses other mail, chat and sign-in sites', () => {
    for (const input of ['mail.yahoo.com', 'yahoo.com', 'proton.me', 'mail.proton.me', 'web.whatsapp.com', 'discord.com', 'teams.microsoft.com', 'login.microsoftonline.com', 'icloud.com']) {
      expect(siteFromInput(input).ok, input).toBe(false);
    }
  });

  it('refuses a suffix shared by many unrelated sites, but accepts a site under it', () => {
    for (const input of ['co.uk', 'github.io', 'vercel.app', 'com.au']) {
      expect(siteFromInput(input).ok, input).toBe(false);
    }
    expect(siteFromInput('acme.co.uk')).toEqual({ ok: true, site: { pattern: 'https://*.acme.co.uk/*', host: 'acme.co.uk' } });
    expect(siteFromInput('acme.github.io').ok).toBe(true);
  });

  it('refuses things that are not https websites', () => {
    for (const input of ['', 'http://example.com', 'localhost', '10.0.0.1', 'not a site', 'ftp://example.com', 'chrome://settings']) {
      expect(siteFromInput(input).ok, input).toBe(false);
    }
  });
});

describe('learningSites', () => {
  it('lists only the sites the user added, never the built-in ones', () => {
    expect(learningSites([...BUILT_IN_ORIGINS, 'https://*.notion.so/*', 'https://*.atlassian.net/*', 'https://*.notion.so/*'])).toEqual([
      { pattern: 'https://*.atlassian.net/*', host: 'atlassian.net' },
      { pattern: 'https://*.notion.so/*', host: 'notion.so' },
    ]);
    expect(learningSites(undefined)).toEqual([]);
  });
});

describe('isLearnablePageUrl', () => {
  it('matches the app rules', () => {
    expect(isLearnablePageUrl('https://www.notion.so/acme')).toBe(true);
    expect(isLearnablePageUrl('http://www.notion.so/acme')).toBe(false);
    expect(isLearnablePageUrl('https://mail.google.com/mail/u/0')).toBe(false);
    expect(isLearnablePageUrl('https://app.pranan.ai/home')).toBe(false);
    expect(isLearnablePageUrl(undefined)).toBe(false);
  });
});

describe('manifest and worker', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  const worker = readFileSync('src/background/service-worker.ts', 'utf8');
  const learn = readFileSync('src/content/learn/index.ts', 'utf8');

  it('asks for no new site access up front', () => {
    expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
    expect(manifest.host_permissions).not.toContain('https://*/*');
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(JSON.stringify(manifest.content_scripts)).not.toContain('content/learn.js');
  });

  it('checks the sender, the frame and the granted site before sending a page', () => {
    const handler = worker.slice(worker.indexOf("case 'LEARN_PAGE'"), worker.indexOf("case 'SET_TIER_OVERRIDE'"));
    expect(handler).toContain('sender.id !== chrome.runtime.id');
    expect(handler).toContain('frameId');
    expect(handler).toContain('isLearnablePageUrl(pageUrl)');
    expect(handler).toContain('chrome.permissions.contains');
    // The address sent is the sender's, never one the page supplies.
    expect(handler).toContain('new URL(pageUrl)');
    expect(handler).toContain('postLearnPage({ url: `${origin}${pathname}`');
  });

  it('follows the granted sites', () => {
    expect(worker).toContain('chrome.permissions.onAdded.addListener');
    expect(worker).toContain('chrome.permissions.onRemoved.addListener');
  });

  it('reads nothing until the user clicks, and never in frames or on login pages', () => {
    const top = learn.slice(learn.lastIndexOf('if (window.top === window'));
    expect(top).toContain('looksLikeLoginPage()');
    expect(top).toContain('mount()');
    expect(top).not.toContain('pageText(');
    expect(learn).toMatch(/go\.addEventListener\('click'[\s\S]*pageText\(\)/);
  });
});
