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
});
