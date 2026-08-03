import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The worker answers a failed or refused draft with DRAFT_SKIPPED. Gmail and
 * Slack surfaced it. LinkedIn had no handler at all, so every failure on that
 * surface was silent: prompt cleared, button unchanged, no message, nothing in
 * the compose.
 *
 * Measured 1 Aug on v0.8.49 — pressed Generate in LinkedIn messaging, waited 27
 * seconds, nothing at all happened, while the same payload returned a good
 * draft from /api/companion/draft in 3.4s. A whole surface could fail on every
 * attempt and no user could report anything more useful than "nothing happens".
 *
 * Source-scraping, because the gap is an ABSENT handler. Nothing that exists
 * misbehaves, so no behavioural test can see it.
 */
const SURFACES = [
  'src/content/gmail/index.ts',
  'src/content/slack/index.ts',
  'src/content/linkedin/index.ts',
];
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('every surface surfaces a failed draft', () => {
  it.each(SURFACES)('%s handles DRAFT_SKIPPED', (rel) => {
    expect(read(rel)).toContain('DRAFT_SKIPPED');
  });

  it.each(SURFACES)('%s does something with it rather than swallowing it', (rel) => {
    // Scan the whole file rather than a window after the first hit: in Gmail
    // the first occurrence is a comment and the handler follows further down.
    const src = read(rel);
    expect(src).toMatch(/payload\?\.message|payload\.message|skipMessage/);
  });
});
