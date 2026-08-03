import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Spotted by Pratik on 1 Aug: "Why is it dark theme when we have light theme on
 * the extension?"
 *
 * Four inline bars ship across three surfaces. Three were white cards on a
 * light border; LinkedIn's MESSAGING bar alone was a dark purple gradient with
 * near-white text — a leftover from an earlier dark design. Even the other
 * LinkedIn bar, for comments, was already light.
 *
 *   gmail    #ffffff
 *   slack    #ffffff
 *   linkedin comment  #ffffff
 *   linkedin message  linear-gradient(135deg, rgba(20,10,35,.97), rgba(14,10,31,.97))
 *
 * A source-scraping test because the thing to prevent is a fifth bar arriving
 * with its own palette, which no behavioural test would notice.
 */
const SURFACES = [
  'src/content/gmail/index.ts',
  'src/content/slack/index.ts',
  'src/content/linkedin/index.ts',
];
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('inline bars share one light theme', () => {
  it.each(SURFACES)('%s ships no dark bar surface', (rel) => {
    const src = read(rel);
    // the specific dark palette that shipped
    expect(src).not.toContain('rgba(20,10,35');
    expect(src).not.toContain('rgba(14,10,31');
  });

  it.each(SURFACES)('%s has no near-white body text (unreadable on a white card)', (rel) => {
    expect(read(rel)).not.toMatch(/color:\s*#fafafa/);
  });

  it('every bar declares the same white card background', () => {
    for (const rel of SURFACES) {
      const src = read(rel);
      if (!/data-pranan.*bar|PRANAN_.*BAR_ATTR/i.test(src)) continue;
      expect(src).toMatch(/background:\s*(#ffffff|white)/);
    }
  });
});
