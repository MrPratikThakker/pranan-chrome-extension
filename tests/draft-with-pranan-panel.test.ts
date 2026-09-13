import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from './helpers/strip-comments';

const raw = readFileSync(resolve(__dirname, '../src/content/gmail/index.ts'), 'utf8');
const src = stripComments(raw);

/**
 * Drishti, 7 Aug: "we don't really have a generate option here."
 *
 * Reproduced on real Gmail, 13 Aug. The "Draft with Pranan" panel — opened from
 * the purple icon in Gmail's compose toolbar — had a prompt box and NO submit
 * control of any kind. The only way to send was Cmd/Ctrl+Enter, advertised as
 * "Press ⌘⏎ to generate" in 10px grey. Measured behaviour:
 *
 *   Enter       -> nothing
 *   ⌘ alone     -> nothing   (what the hint appears to say)
 *   ⌘ + Enter   -> submits
 *
 * Her recording has her reading that hint, saying "I am unable to understand
 * what this is", pressing Enter, getting nothing, and giving up. Every other
 * Pranan surface has a Generate button.
 */
describe('the Draft with Pranan panel can be submitted', () => {
  it('does not expose a stale model provider in the compact compose UI', () => {
    expect(src).toContain("popover.setAttribute('aria-label', 'Draft with Pranan')");
    expect(src).not.toContain('Private workspace &middot; Anthropic');
  });

  it('has a clear context-aware draft button, not just a keyboard shortcut', () => {
    expect(src).toContain('data-pranan-generate');
    const action = src.slice(src.indexOf('data-pranan-generate'));
    expect(action.slice(0, 700)).toContain("'Draft reply'");
  });

  it('wires that button to the submit path', () => {
    expect(src).toMatch(/generateBtn\.addEventListener\('click'[\s\S]{0,120}submitFreeformPrompt\(\)/);
  });

  it('keeps the full-width composer bar behind an explicit diagnostic flag', () => {
    const inject = src.slice(src.indexOf('function injectComposeButtons'), src.indexOf('function rescueComposeTitle'));
    expect(inject).toContain("PRANAN_LEGACY_COMPOSE_BAR') === '1'");
    expect(inject).toContain('injectFloatingIcon(composeWindow, recipientEmail)');
  });

  it('submits on plain Enter — the thing she actually tried', () => {
    const handler = src.slice(src.indexOf("promptEl.addEventListener('keydown'"));
    const body = handler.slice(0, handler.indexOf('});'));
    expect(body).toMatch(/e\.key === 'Enter'/);
    expect(body).toMatch(/submitFreeformPrompt\(\)/);
  });

  it('keeps Shift+Enter as a newline', () => {
    const handler = src.slice(src.indexOf("promptEl.addEventListener('keydown'"));
    expect(handler.slice(0, handler.indexOf('});'))).toContain('!e.shiftKey');
  });

  // The old hint was two symbols at 10px. Whatever it says now must not be the
  // ONLY way to discover how to submit.
  it('no longer relies on the reader recognising ⌘⏎', () => {
    expect(src).not.toContain('&#8984;&#9166;');
  });

  /**
   * The panel used to call popover.remove() on the same tick as the send, so a
   * failed request looked exactly like a successful one — the same silence that
   * made the panel feel broken to begin with.
   */
  it('does not dismiss itself before the request is acknowledged', () => {
    const fn = src.slice(src.indexOf('const submitFreeformPrompt'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    const awaitAt = body.indexOf('await safeSendMessage');
    const closeAt = body.indexOf('popover.remove()');
    expect(awaitAt).toBeGreaterThan(-1);
    // Acknowledgement is not completion: the panel now stays open for retries.
    expect(closeAt).toBe(-1);
    expect(src).toContain("message.payload?.requestId !== popoverRequest");
  });

  it('says so instead of vanishing when the request fails', () => {
    const fn = src.slice(src.indexOf('const submitFreeformPrompt'));
    expect(fn.slice(0, fn.indexOf('\n  };'))).toContain('Try again');
  });

  it('shows that it is working while the draft is in flight', () => {
    const fn = src.slice(src.indexOf('const submitFreeformPrompt'));
    expect(fn.slice(0, fn.indexOf('\n  };'))).toContain('Drafting');
  });
});
