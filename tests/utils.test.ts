/**
 * Tests for utils helpers — guards against regressions in the human-friendly
 * date formatting that is part of every relationship card.
 */

import { describe, it, expect } from 'vitest';
import { formatLastInteraction } from '@/lib/utils';

describe('formatLastInteraction', () => {
  it('returns "No history" for null', () => {
    expect(formatLastInteraction(null)).toBe('No history');
  });

  it('returns "No history" for undefined', () => {
    expect(formatLastInteraction(undefined)).toBe('No history');
  });

  it('returns "No history" for empty string', () => {
    expect(formatLastInteraction('')).toBe('No history');
  });

  it('returns "No history" for non-parseable strings', () => {
    expect(formatLastInteraction('not a date')).toBe('No history');
  });

  it('returns "Today" for a same-day date', () => {
    expect(formatLastInteraction(new Date().toISOString())).toBe('Today');
  });

  it('returns "Yesterday" for ~24h ago', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    expect(formatLastInteraction(d.toISOString())).toBe('Yesterday');
  });

  it('returns "N days ago" for 2-6 days', () => {
    const d = new Date();
    d.setDate(d.getDate() - 4);
    expect(formatLastInteraction(d.toISOString())).toBe('4 days ago');
  });

  it('returns "N weeks ago" for 7-29 days', () => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    expect(formatLastInteraction(d.toISOString())).toBe('2 weeks ago');
  });

  it('returns "N months ago" for 30+ days', () => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    expect(formatLastInteraction(d.toISOString())).toBe('3 months ago');
  });
});
