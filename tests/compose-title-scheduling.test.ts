import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gmail = readFileSync(resolve(__dirname, '../src/content/gmail/index.ts'), 'utf8');

/**
 * The rescue itself was never the bug -- it shipped in v0.8.33 and was corrected
 * in v0.8.34. The bug was WHEN it ran, and that is absent code: nothing a
 * behavioural test can observe. These pin the scheduling instead.
 */
describe('compose title rescue is wired to signals that fire when it matters', () => {
  const positioner = gmail.slice(
    gmail.indexOf('function positionComposeBar('),
    gmail.indexOf('function injectPromptBar('),
  );

  it('runs inside the positioner, so it inherits every signal apply() has', () => {
    expect(positioner).toContain('rescueComposeTitle(getCompose())');
  });

  // If it drifts below one of apply()'s early returns it silently stops running
  // in exactly the overflowing-dialog cases it exists for.
  it('runs above the early returns, not after them', () => {
    const call = positioner.indexOf('rescueComposeTitle(getCompose())');
    const firstReturn = positioner.indexOf('if (!sendButton || !sendRow) {');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(firstReturn);
  });

  // v0.8.33-v0.8.52: requestAnimationFrame + one 600ms timeout, then nothing.
  // Both landed while Gmail was still sizing the dialog, and rAF does not fire
  // at all in a background tab.
  it('is not scheduled as a one-shot at injection time', () => {
    expect(gmail).not.toContain('requestAnimationFrame(keepComposeTitleVisible)');
    expect(gmail).not.toContain('setTimeout(keepComposeTitleVisible, 600)');
  });

  it('survives a background tab, where requestAnimationFrame never fires', () => {
    // apply() is called directly and on plain timeouts, not only via rAF.
    expect(positioner).toMatch(/\n  apply\(\);/);
    expect(positioner).toMatch(/\[[\d, ]+\]\.forEach\(\(ms\) => setTimeout\(apply, ms\)\)/);
  });

  it('re-runs when the dialog resizes -- the moment the title row is pushed off-screen', () => {
    expect(positioner).toContain('new ResizeObserver');
    expect(positioner).toContain('ro.observe(dialog)');
  });

  it('re-runs on viewport resize', () => {
    expect(positioner).toContain("window.addEventListener('resize', apply)");
  });

  // Both the V6 and the legacy bar go through positionComposeBar; the old
  // rescue lived in injectPromptBarV6 only, so legacy never had it.
  it('covers the legacy bar too', () => {
    const calls = gmail.match(/positionComposeBar\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3); // 1 definition + 2 call sites
  });
});

describe('the cap can never make Send unreachable', () => {
  const positioner = gmail.slice(
    gmail.indexOf('function positionComposeBar('),
    gmail.indexOf('function injectPromptBar('),
  );

  it('checks reachability every time it caps the height', () => {
    expect(gmail).toContain('keepComposeContentReachable(dialog)');
  });

  // Only when our own cap is what is biting. Gmail's dialog overflows on
  // purpose elsewhere, and forcing auto there clips its menus.
  it('only touches overflow on a dialog we capped', () => {
    const fn = gmail.slice(gmail.indexOf('function keepComposeContentReachable'));
    expect(fn.slice(0, 400)).toContain('if (!dialog.style.maxHeight) return');
  });
});
