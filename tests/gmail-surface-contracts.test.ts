/**
 * Source contracts for Gmail content-script fixes that need a live Gmail DOM
 * to exercise end to end (the behavioural pieces they rely on are tested in
 * instance-guard, audio-transfer and service-worker-routing).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { stripComments } from './helpers/strip-comments';

const gmail = stripComments(readFileSync('src/content/gmail/index.ts', 'utf8'));

describe('Gmail content script', () => {
  it('hands the thread-view prompt to the reply\'s compose popover (EXT-04)', () => {
    const bar = gmail.slice(gmail.indexOf('function injectThreadPromptBar'), gmail.indexOf('function findThreadViews'));
    expect(bar).toContain('openComposePopover(anchor, replyCompose, { initialPrompt: prompt, autoSubmit: !!prompt })');
  });

  it('reads the relationship popup data from the worker\'s { data } reply (EXT-05)', () => {
    const popup = gmail.slice(gmail.indexOf('function showComposeRelationshipPopup'), gmail.indexOf('function renderRelationshipPopup'));
    expect(popup).toContain('?.data ?? null');
    expect(popup).not.toContain('response as RelationshipPopupData');
  });

  it('gates every top-level listener on being the only live copy (EXT-21)', () => {
    expect(gmail).toContain("const IS_PRIMARY_INSTANCE = claimContentScriptInstance('gmail');");
    expect(gmail).toContain("if (IS_PRIMARY_INSTANCE) document.addEventListener('mouseup'");
    expect(gmail).toContain('if (IS_PRIMARY_INSTANCE) chrome.runtime.onMessage.addListener(');
    expect(gmail).toMatch(/if \(!IS_PRIMARY_INSTANCE\) \{[\s\S]{0,80}\} else if \(document\.readyState === 'loading'\)/);
  });

  it('only keeps the reply channel open for the async insert path (EXT-28)', () => {
    const listener = gmail.slice(gmail.indexOf('if (IS_PRIMARY_INSTANCE) chrome.runtime.onMessage.addListener('));
    const body = listener.slice(0, listener.indexOf('\n});\n'));
    expect(body.trimEnd().endsWith('return false;')).toBe(true);
  });

  it('uses only the canonical relationship tiers in the tier pill', () => {
    expect(gmail).not.toMatch(/partner: 'partner'/);
    expect(gmail).toContain("prospect: 'prospect'");
    expect(gmail).toContain("vendor: 'vendor'");
  });
});

describe('side panel fonts (EXT-26)', () => {
  it('ships its fonts instead of loading Google Fonts at runtime', () => {
    expect(readFileSync('sidepanel.html', 'utf8')).not.toContain('fonts.googleapis.com');
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(css).toContain("url('../assets/fonts/inter-300-900-latin.woff2')");
    expect(css).toContain("url('../assets/fonts/jetbrains-mono-400-500-latin.woff2')");
  });
});

describe('environment-aware links (EXT-25 / XP-27)', () => {
  it('the saved-text link follows the build\'s app origin', async () => {
    const { compactPromptBar } = await import('../src/content/shared/compact-prompt-bar');
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K) => document.createElement(tag);
    const bar = make('div');
    compactPromptBar({ bar, icon: make('span'), input: make('input'), generate: make('button'), relationship: make('span'), tone: make('span'), sidePanel: make('button') });
    const link = Array.from(bar.querySelectorAll('a')).find((a) => a.textContent === 'Manage saved text')!;
    const { appUrl } = await import('../src/lib/config');
    expect(link.href).toBe(appUrl('/settings/snippets'));
    expect(readFileSync('src/content/shared/compact-prompt-bar.ts', 'utf8')).not.toContain('https://app.pranan.ai');
  });
});
