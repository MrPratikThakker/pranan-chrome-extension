import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers/strip-comments';

const raw = readFileSync(resolve(__dirname, '../src/content/linkedin/index.ts'), 'utf8');
// Comments here quote the very calls being counted -- strip before scanning.
const li = stripComments(raw);

/**
 * Both LinkedIn bars cleared the prompt on click and changed nothing else, so
 * pressing Generate looked exactly the same whether a draft was on its way or
 * the request had died. Gmail has had setLoading() and Slack a "Drafting..."
 * label for months; LinkedIn never got one.
 */
describe('LinkedIn bars show that a draft is in flight', () => {
  it('enters a busy state on every draft request', () => {
    const requests = (li.match(/type: 'INLINE_DRAFT_REQUEST'/g) || []).length;
    const busy = (li.match(/setLinkedInBarsBusy\(true\)/g) || []).length;
    expect(requests).toBeGreaterThan(0);
    expect(busy).toBe(requests);
  });

  it('leaves the busy state on a draft, a comment draft, or a skip', () => {
    for (const type of ['INSERT_DRAFT', 'DRAFT_SKIPPED', 'INSERT_COMMENT_DRAFT']) {
      const at = li.indexOf(`if (message.type === '${type}') {`);
      expect(at, `${type} handler missing`).toBeGreaterThan(-1);
      expect(li.slice(at, at + 200)).toContain('setLinkedInBarsBusy(false)');
    }
  });

  /**
   * Measured 1 Aug: Generate pressed in messaging, 27 seconds of nothing, no
   * INSERT_DRAFT and no DRAFT_SKIPPED ever arriving, while the same payload
   * returned a good draft from the API in 3.4s. If a reply can vanish, a busy
   * state with no timeout hangs on "Drafting..." forever — a worse lie than the
   * silence it replaced.
   */
  it('cannot hang on "Drafting..." forever when no reply arrives', () => {
    const fn = li.slice(li.indexOf('function setLinkedInBarsBusy'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('LI_BUSY_TIMEOUT_MS');
    expect(body).toMatch(/setTimeout\([\s\S]{0,160}setLinkedInBarsBusy\(false\)/);
    expect(body).toContain('showLinkedInNotice');
  });

  // Each bar has a close button too, and the two bars use different idle
  // labels — "Generate" on comments, "Draft" in messaging.
  it('restores each bar to its own label, not a shared one', () => {
    expect(li).toContain("generateBtn.dataset.prananGenerate = 'Generate'");
    expect(li).toContain("generateBtn.dataset.prananGenerate = 'Draft'");
    expect(li).toContain('btn.dataset.prananGenerate ||');
  });
});

/**
 * Verified on real LinkedIn, 4 Aug. Pressing Generate produced:
 *
 *   before   "Generate  | pe=auto"
 *   +50ms    "Drafting... | pe=auto"    <- label changed, button still live
 *   +1500ms  "Generate  | pe=auto"      <- draft landed, cleared correctly
 *
 * The label worked; the dimming and click-blocking did not. triggerDraft reset
 * opacity and pointerEvents from generateButtonState('') immediately after
 * setLinkedInBarsBusy(true), undoing them on the same tick. The button looked
 * live and stayed clickable for the whole request — so the busy state was
 * cosmetic exactly where it mattered, and a second click could still fire.
 */
describe('nothing undoes the busy state on the same tick', () => {
  it('does not reset the button style after entering busy', () => {
    expect(li).not.toContain('generateBtn.style.pointerEvents = stAfter.pointerEvents');
    expect(li).not.toContain("const stAfter = generateButtonState('')");
  });

});
