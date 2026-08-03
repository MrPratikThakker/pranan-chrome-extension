import { describe, it, expect } from 'vitest';
import { generateButtonState } from '../src/content/shared/generate-affordance';

/**
 * Measured live in Slack on v0.8.44, in a real channel.
 *
 * The inline bar renders a prompt field and a dismiss "×". The Generate button
 * is present in the DOM but `opacity: 0; pointer-events: none`, and stays that
 * way until the user types into Pranan's own prompt field:
 *
 *   input.addEventListener('input', () => {
 *     const hasText = input.value.trim().length > 0;
 *     generateBtn.style.opacity = hasText ? '1' : '0';
 *     generateBtn.style.pointerEvents = hasText ? 'auto' : 'none';
 *   });
 *
 * Probed at five points across the button's own rect: not clickable at any of
 * them. Hovering the bar does not reveal it. The only control a user can
 * actually press is the one that dismisses the feature.
 *
 * Gmail does not work this way — its Generate is always live and drafts from
 * thread context with no prompt at all, which is the whole one-tap promise.
 * Slack has the same context available (getThreadContext /
 * getRecentChannelMessages), so requiring a typed prompt buys nothing and hides
 * the primary action behind a step nobody is told about.
 */
describe('generateButtonState', () => {
  it('is visible and clickable with no prompt typed — same as Gmail', () => {
    expect(generateButtonState('')).toEqual({ opacity: '1', pointerEvents: 'auto' });
  });

  it('stays visible and clickable once a prompt is typed', () => {
    expect(generateButtonState('say thanks')).toEqual({ opacity: '1', pointerEvents: 'auto' });
  });

  it('treats whitespace as no prompt, and still shows the button', () => {
    expect(generateButtonState('   ')).toEqual({ opacity: '1', pointerEvents: 'auto' });
  });

  // The regression: any state where the user cannot see or press Generate.
  it.each(['', '   ', 'a prompt', undefined, null])(
    'never hides the primary action (%s)',
    (value) => {
      const state = generateButtonState(value as string);
      expect(state.opacity).not.toBe('0');
      expect(state.pointerEvents).not.toBe('none');
    },
  );
});
