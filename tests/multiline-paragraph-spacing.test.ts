import { describe, it, expect, beforeEach } from 'vitest';
import { injectMultilineText } from '../src/lib/safe-dom';

/**
 * Every Slack and LinkedIn draft arrived with enormous gaps between paragraphs.
 * Measured on 1 Aug, LinkedIn messaging:
 *
 *   "Hi Sahil,\n\n\n\n\nI'm doing well...\n\n\n\n\nBest,\n\nPratik"
 *
 * The backend was not at fault — calling /api/companion/draft directly returned
 * clean single blank lines: "Hi Sahil,\n\nI'm doing well...". The extension
 * turned them into that.
 *
 * injectMultilineText splits on \n and emits one block per line, including an
 * empty block carrying a <br> for each blank line. With tag 'div' that is right:
 * a div has no margin, so the empty div IS the blank line, which is why Gmail
 * always looked correct. With tag 'p' — what Slack and LinkedIn pass — the
 * paragraph already carries a margin, so the extra empty paragraph adds a
 * SECOND gap on top of it.
 */
describe('injectMultilineText paragraph spacing', () => {
  let node: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="t"></div>';
    node = document.getElementById('t') as HTMLElement;
  });

  const DRAFT = "Hi Sahil,\n\nI'm doing well, thanks.\n\nBest,\nPratik";

  it('emits no empty paragraphs — the margin already separates them', () => {
    injectMultilineText(node, DRAFT, 'p');
    const empties = [...node.querySelectorAll('p')].filter(p => !p.textContent?.trim());
    expect(empties.length).toBe(0);
  });

  it('keeps every line of real content, in order', () => {
    injectMultilineText(node, DRAFT, 'p');
    const text = [...node.querySelectorAll('p')].map(p => p.textContent);
    expect(text).toEqual(["Hi Sahil,", "I'm doing well, thanks.", "Best,", "Pratik"]);
  });

  it('collapses a long run of blank lines rather than stacking gaps', () => {
    injectMultilineText(node, "One\n\n\n\n\nTwo", 'p');
    expect(node.querySelectorAll('p').length).toBe(2);
  });

  // Gmail's compose is div-based with no paragraph margin, so the empty block
  // IS the blank line there. That behaviour must not change.
  it('preserves blank-line blocks for div targets (Gmail)', () => {
    injectMultilineText(node, "One\n\nTwo", 'div');
    const divs = [...node.querySelectorAll('div')];
    expect(divs.length).toBe(3);
    expect(divs[1].querySelector('br')).not.toBeNull();
  });

  it('handles a single line and empty input safely', () => {
    injectMultilineText(node, 'Just one line', 'p');
    expect(node.querySelectorAll('p').length).toBe(1);
    injectMultilineText(node, '', 'p');
    expect(node.textContent).toBe('');
  });
});
