import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { conversationKindFromUrl } from '../src/lib/slack-conversation';

/**
 * Pilot report: drafts in the team channel opened "Hi goal26-ancil-ai-launch,"
 * — the channel slug greeted as a person.
 *
 * Measured on that exact channel, 4 Aug 2026:
 *   url                       /client/T045HMRNS7L/C0AU31GRUDU
 *   [data-qa="channel_name"]  "goal26-ancil-ai-launch"   <- no "#"
 *   member count element      absent
 *
 * isDirectMessage() checked the URL only for D/G, fell through on a C id, and
 * then guessed from the DOM: "no # so not a channel" and "no member count so
 * not a channel". Both wrong, so it returned true and getDMRecipient() handed
 * back the slug.
 */
describe('conversationKindFromUrl', () => {
  it('reads the pilot channel as a channel', () => {
    expect(conversationKindFromUrl('/client/T045HMRNS7L/C0AU31GRUDU')).toBe('channel');
  });

  it('still reads DMs and group DMs as DMs', () => {
    expect(conversationKindFromUrl('/client/T045HMRNS7L/D01ABCDEFGH')).toBe('dm');
    expect(conversationKindFromUrl('/client/T045HMRNS7L/G01ABCDEFGH')).toBe('dm');
  });

  // Where the URL genuinely does not say, the DOM fallbacks must still run.
  it('reports unknown when the URL carries no conversation id', () => {
    expect(conversationKindFromUrl('/client/T045HMRNS7L/search')).toBe('unknown');
    expect(conversationKindFromUrl('/client/T045HMRNS7L')).toBe('unknown');
    expect(conversationKindFromUrl('/')).toBe('unknown');
  });

  /**
   * Caught live on 4 Aug: opening a DM from the flyout leaves the URL as
   * "/client/T045HMRNS7L/dms" — a VIEW name, not a conversation id. A loose,
   * case-insensitive match read "dms" as a D-prefixed DM id and returned 'dm',
   * which was right by accident. Slack ids are uppercase and 9+ chars.
   */
  it('does not mistake a view name for a conversation id', () => {
    expect(conversationKindFromUrl('/client/T045HMRNS7L/dms')).toBe('unknown');
    expect(conversationKindFromUrl('/client/T045HMRNS7L/search')).toBe('unknown');
    expect(conversationKindFromUrl('/client/T045HMRNS7L/drafts')).toBe('unknown');
    expect(conversationKindFromUrl('/client/T045HMRNS7L/činnost')).toBe('unknown');
  });

  it('does not throw on nonsense input', () => {
    // @ts-expect-error deliberately wrong
    expect(conversationKindFromUrl(null)).toBe('unknown');
    // @ts-expect-error deliberately wrong
    expect(conversationKindFromUrl(undefined)).toBe('unknown');
  });
});

const slack = readFileSync(resolve(__dirname, '../src/content/slack/index.ts'), 'utf8');

describe('a channel name can never be used as a person', () => {
  it('trusts the URL before guessing from the DOM', () => {
    expect(slack).toContain('conversationKindFromUrl');
    const fn = slack.slice(slack.indexOf('function isDirectMessage'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // The channel verdict must be returned, not merely computed.
    expect(body).toMatch(/'channel'[\s\S]{0,80}return false/);
  });

  /**
   * getDMRecipient's last fallback accepted any header text not starting with
   * "#". Slack channel headers do not start with "#", so on its own that would
   * still return the slug even once isDirectMessage was fixed.
   */
  it('refuses to name a recipient outside a DM at all', () => {
    const fn = slack.slice(slack.indexOf('function getDMRecipient'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/if \(!isDirectMessage\(\)\) return null/);
  });
});
