import { describe, it, expect } from 'vitest';
import { parseLinkedInPostText } from '../src/content/linkedin/post-parse';

// Real captured innerText (2026-06-10) from a feed post with the comment box
// open — includes the existing comment thread that must NOT leak into the body.
const RAW = [
  'Feed post',
  'Ryan McRae',
  ' • 1st',
  'I’m the Dollar Tree Dan Tyre// Ex-Hubspotter. // Open Flow-er',
  '4d • Edited •',
  'Day 100: Hanging out with Bryan Azeka at the Partner Summit at HubSpot representing Open Flow, Inc. A great time. WHOOO!',
  '… more',
  '65',
  '5',
  '​',
  'Most relevant',
  'Bryan Azeka',
  'Managing Partner at Open Flow, Inc.',
  'Fun times all around! We’ll be back in Boston for sure!',
].join('\n');

describe('parseLinkedInPostText', () => {
  it('extracts author and the real post body', () => {
    const { author, body } = parseLinkedInPostText(RAW);
    expect(author).toBe('Ryan McRae');
    expect(body).toContain('Day 100: Hanging out with Bryan Azeka at the Partner Summit');
  });

  it('excludes the comments thread and UI noise', () => {
    const { body } = parseLinkedInPostText(RAW);
    expect(body).not.toMatch(/Most relevant/i);
    expect(body).not.toMatch(/Fun times all around/i); // an existing comment
    expect(body).not.toMatch(/^65$|^5$/m);             // reaction/comment counts
    expect(body).not.toMatch(/Feed post/i);
  });

  it('returns null body for empty input', () => {
    expect(parseLinkedInPostText('').body).toBeNull();
  });

  it('picks the Page name (not a follower row) on a company Page post', () => {
    const RAW_PAGE = [
      'Zeck',
      '12,985 followers',
      'Promoted',
      'Most board meetings fail because of process, not strategy.',
      'Get 5 cheat codes modern CEOs use to keep directors engaged.',
      '…more',
      'Joe Pelayo, Rajesh John and 33 other connections follow this Page',
    ].join('\n');
    const { author, body } = parseLinkedInPostText(RAW_PAGE);
    expect(author).toBe('Zeck');
    expect(body).toContain('Most board meetings fail');
    expect(author).not.toMatch(/follow this Page/i);
    expect(body).not.toMatch(/follow this Page/i);
  });

  it('picks the real author (not the resurfacer) on a "X commented" post', () => {
    const RAW_RESURFACE = [
      'Justin Welsh commented on this',
      'Feed post',
      'Sahil Bloom',
      ' • 2nd',
      'Author, The 5 Types of Wealth',
      '1d •',
      'The most underrated skill in business is writing clearly.',
      '…more',
      '120',
    ].join('\n');
    const { author, body } = parseLinkedInPostText(RAW_RESURFACE);
    expect(author).toBe('Sahil Bloom');
    expect(author).not.toMatch(/commented/i);
    expect(body).toContain('underrated skill');
  });

  it('does not truncate body prose that uses the words commented/reposted', () => {
    const RAW_SAFE = [
      'Feed post',
      'Dana Lee',
      ' • 1st',
      'Head of Product',
      '2h •',
      'A customer commented that our onboarding felt slow, so we reposted our roadmap for transparency.',
      '…more',
    ].join('\n');
    const { author, body } = parseLinkedInPostText(RAW_SAFE);
    expect(author).toBe('Dana Lee');
    expect(body).toContain('A customer commented that our onboarding felt slow, so we reposted our roadmap');
  });
});
