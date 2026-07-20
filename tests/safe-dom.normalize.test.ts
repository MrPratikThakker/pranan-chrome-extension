import { describe, it, expect } from 'vitest';
import { normalizeDraftForPlainText } from '../src/lib/safe-dom';

describe('normalizeDraftForPlainText', () => {
  it('strips bold markers', () => {
    expect(normalizeDraftForPlainText('**Live chat:** ready')).toBe('Live chat: ready');
    expect(normalizeDraftForPlainText('__Monthly goal__ set')).toBe('Monthly goal set');
  });
  it('converts markdown bullets to a glyph', () => {
    expect(normalizeDraftForPlainText('- item one\n- item two')).toBe('• item one\n• item two');
    expect(normalizeDraftForPlainText('* star bullet')).toBe('• star bullet');
  });
  it('flattens ATX headings', () => {
    expect(normalizeDraftForPlainText('## Summary')).toBe('Summary');
  });
  it('turns links into label (url)', () => {
    expect(normalizeDraftForPlainText('[docs](https://pranan.ai/x)')).toBe('docs (https://pranan.ai/x)');
  });
  it('strips inline code backticks', () => {
    expect(normalizeDraftForPlainText('run `npm test` now')).toBe('run npm test now');
  });
  it('leaves filenames, emails, and snake_case untouched', () => {
    expect(normalizeDraftForPlainText('see report_final_v2.pdf from a_b@x.com')).toBe('see report_final_v2.pdf from a_b@x.com');
  });
  it('preserves paragraph structure and signatures', () => {
    const t = 'Hi Darlene,\n\nSounds good! No pressure.\n\nBest regards,\nSwapnali';
    expect(normalizeDraftForPlainText(t)).toBe(t);
  });
});
