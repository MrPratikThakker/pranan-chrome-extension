import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Three bars shipped the same defect independently: Slack's inline bar, and
 * LinkedIn's messaging and comment bars each hid their primary action until the
 * user typed a prompt, with no hint that typing was required.
 *
 * Measured on LinkedIn, 1 Aug 2026, comment box focused on a real feed post:
 * the bar renders a prompt field and a dismiss "x", and the Draft button sits at
 * opacity 0 / pointer-events none. The only control a user can press is the one
 * that turns the feature off. Slack was identical, fixed in v0.8.45.
 *
 * A source-scraping test because the failure to guard is someone writing the
 * ternary again on a fourth bar. No test of existing behaviour would catch that.
 */
const SURFACES = ['src/content/slack/index.ts', 'src/content/linkedin/index.ts'];
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('no surface hides its own Generate button', () => {
  it.each(SURFACES)('%s never toggles opacity on prompt text', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/opacity\s*=\s*hasText/);
    expect(src).not.toMatch(/pointerEvents\s*=\s*hasText/);
  });

  it.each(SURFACES)('%s never ships a button with opacity 0 + pointer-events none', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/opacity:\s*0;\s*pointer-events:\s*none/);
  });

  it.each(SURFACES)('%s routes button state through the shared helper', (rel) => {
    expect(read(rel)).toContain('generateButtonState');
  });
});
