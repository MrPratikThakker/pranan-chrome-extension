import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from './helpers/strip-comments';

const li = stripComments(readFileSync(resolve(__dirname, '../src/content/linkedin/index.ts'), 'utf8'));

/**
 * Measured on real LinkedIn messaging, 4 Aug 2026. Every selector in BOTH the
 * profileName and conversationHeader chains returned zero matches, so
 * getConversationRecipient() returned null. The visible result: the bar read
 * "Draft message with Pranan..." with no name, and a generated draft opened
 * "Hi there, I'm doing well..." to a named contact.
 *
 * LinkedIn removed the inner <span>; the name now sits directly in
 * h2.msg-entity-lockup__entity-title (one match, in the thread header, and the
 * sidebar conversation list does not share the class).
 */
describe('LinkedIn messaging can name the person it is drafting to', () => {
  const chain = li.slice(li.indexOf('profileName: ['), li.indexOf(']', li.indexOf('profileName: [')));

  it('matches the current DOM, where the name is not in a span', () => {
    expect(chain).toContain("'.msg-entity-lockup__entity-title'");
  });

  it('prefers the thread-scoped form so it cannot read the sidebar', () => {
    const scoped = chain.indexOf("'.msg-thread .msg-entity-lockup__entity-title'");
    const bare = chain.indexOf("'.msg-entity-lockup__entity-title'");
    expect(scoped).toBeGreaterThan(-1);
    expect(scoped).toBeLessThan(bare);
  });

  // The dead selector stays as a trailing fallback rather than being deleted —
  // LinkedIn ships DOM changes per-surface, not all at once.
  it('keeps the old span variant as a fallback, not as the primary', () => {
    const span = chain.indexOf("'.msg-entity-lockup__entity-title span'");
    const bare = chain.indexOf("'.msg-entity-lockup__entity-title'");
    expect(span).toBeGreaterThan(bare);
  });
});
