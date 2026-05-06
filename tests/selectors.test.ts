/**
 * Tests for the selector registry helpers. These guard the fallback-chain
 * behavior we rely on to survive Gmail/Slack/LinkedIn UI shifts.
 *
 * observability is mocked so reports don't actually fire Sentry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/observability', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureError: vi.fn(),
  bootstrapSentry: vi.fn(),
  setUser: vi.fn(),
}));

import { findOne, findAll, SELECTORS } from '@/content/selectors';
import { addBreadcrumb, captureMessage } from '@/lib/observability';

describe('findOne', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('returns the first match when primary selector hits', () => {
    document.body.innerHTML = '<a class="primary">A</a><a class="fallback">B</a>';
    const el = findOne('test.basic', ['.primary', '.fallback']);
    expect(el?.textContent).toBe('A');
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('falls back to the next selector when primary is empty', () => {
    document.body.innerHTML = '<a class="fallback">F</a>';
    const el = findOne('test.fallback_used', ['.primary', '.fallback']);
    expect(el?.textContent).toBe('F');
    expect(addBreadcrumb).toHaveBeenCalled();
  });

  it('returns null + reports chain_broken when nothing matches', () => {
    document.body.innerHTML = '<div>nothing relevant</div>';
    const el = findOne('test.broken', ['.nope1', '.nope2']);
    expect(el).toBeNull();
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('selector_chain_broken'),
      expect.any(Object),
    );
  });

  it('survives invalid selectors by skipping them', () => {
    document.body.innerHTML = '<a class="ok">X</a>';
    const el = findOne('test.invalid_skipped', ['{not a selector}', '.ok']);
    expect(el?.textContent).toBe('X');
  });
});

describe('findAll', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('returns all matches from the first chain entry that has any', () => {
    document.body.innerHTML = '<a class="hit">1</a><a class="hit">2</a><a class="other">3</a>';
    const els = findAll('test.all', ['.hit', '.other']);
    expect(els.length).toBe(2);
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('falls back to subsequent entry when primary returns empty', () => {
    document.body.innerHTML = '<a class="other">3</a>';
    const els = findAll('test.all_fallback', ['.hit', '.other']);
    expect(els.length).toBe(1);
    expect(addBreadcrumb).toHaveBeenCalled();
  });

  it('returns empty array + reports when nothing matches', () => {
    document.body.innerHTML = '<div>x</div>';
    const els = findAll('test.all_broken', ['.no1', '.no2']);
    expect(els).toEqual([]);
    expect(captureMessage).toHaveBeenCalled();
  });
});

describe('SELECTORS registry shape', () => {
  it('has Gmail compose + recipient chains with non-empty fallbacks', () => {
    expect(SELECTORS.gmail.composeBody.length).toBeGreaterThanOrEqual(2);
    expect(SELECTORS.gmail.recipientChips.length).toBeGreaterThanOrEqual(2);
    expect(SELECTORS.gmail.composeWindow.length).toBeGreaterThanOrEqual(2);
  });

  it('includes data-hovercard-id as the primary recipient chip selector', () => {
    // This is the canonical email source on Gmail; if it ever stops being
    // entry 0 of the chain, the fallback escalation logic gets confused.
    expect(SELECTORS.gmail.recipientChips[0]).toContain('data-hovercard-id');
  });
});
