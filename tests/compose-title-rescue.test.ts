import { describe, it, expect } from 'vitest';
import { planComposeTitleRescue, needsForcedPositioning, correctForcedTop, COMPOSE_SAFE_TOP } from '../src/lib/compose-title-rescue';

/**
 * Drishti, 21 July: "the top part of the pop-up email box is getting hidden
 * behind the Gmail UI, restricting me from clicking on Minimize/close."
 *
 * Measured on her class of screen, 1 Aug: viewport 711px, Gmail's new-message
 * dialog needs ~880px, its title bar sitting at y = -19 and Send 105px below the
 * fold.
 *
 * A rescue for this has existed since v0.8.33 and was corrected in v0.8.34 —
 * the original guard required position:fixed/absolute, and Gmail's dialog
 * computes to static, so it never ran for anyone. What was never fixed is WHEN
 * it runs:
 *
 *   requestAnimationFrame(keepComposeTitleVisible);
 *   setTimeout(keepComposeTitleVisible, 600);
 *
 * Twice, both inside 600ms of injection, then never again — while Gmail is
 * still sizing the dialog. By the time the title bar is actually clipped there
 * is nothing left watching. rAF does not fire in a background tab either, so
 * one of the two shots is regularly lost as well.
 *
 * Told her on 22 July it would ship with the next update. It has now shipped
 * three times without working.
 */
describe('planComposeTitleRescue', () => {
  // Her measured geometry.
  it('rescues a floating compose whose title bar is above the screen', () => {
    const plan = planComposeTitleRescue(-19, 860, 711);
    expect(plan).not.toBeNull();
    expect(plan!.top).toBe(COMPOSE_SAFE_TOP);
    expect(plan!.maxHeight).toContain('100vh');
  });

  it('leaves an inline reply alone — it is not anchored to the viewport bottom', () => {
    // bottom sits well above the fold, so this is not a floating popup
    expect(planComposeTitleRescue(-19, 400, 711)).toBeNull();
  });

  // A maximised compose legitimately sits high. Nudging it would re-break the
  // layout v0.8.34 just stopped breaking.
  it('leaves a maximised compose alone', () => {
    expect(planComposeTitleRescue(40, 760, 711)).toBeNull();
  });

  it('does nothing when the title bar is already reachable', () => {
    expect(planComposeTitleRescue(120, 760, 711)).toBeNull();
  });

  it('treats exactly zero as reachable, and one pixel above as not', () => {
    expect(planComposeTitleRescue(0, 760, 711)).toBeNull();
    expect(planComposeTitleRescue(-1, 760, 711)).not.toBeNull();
  });

  // It re-runs on every mutation and resize now, so it must be safe to apply
  // repeatedly to a dialog it has already moved.
  it('is idempotent — re-running against an already-rescued dialog is a no-op', () => {
    const first = planComposeTitleRescue(-19, 860, 711);
    expect(first).not.toBeNull();
    expect(planComposeTitleRescue(COMPOSE_SAFE_TOP, 860, 711)).toBeNull();
  });

  it('survives nonsense geometry rather than throwing in a hot path', () => {
    expect(planComposeTitleRescue(NaN, 860, 711)).toBeNull();
    expect(planComposeTitleRescue(-19, NaN, 711)).toBeNull();
    expect(planComposeTitleRescue(-19, 860, 0)).toBeNull();
  });
});

describe('needsForcedPositioning', () => {
  it('escalates when the gentle fix left the title row off-screen', () => {
    expect(needsForcedPositioning(-19)).toBe(true);
  });

  it('does not escalate when the gentle fix worked', () => {
    expect(needsForcedPositioning(64)).toBe(false);
    expect(needsForcedPositioning(0)).toBe(false);
  });

  it('does not escalate on unmeasurable geometry', () => {
    expect(needsForcedPositioning(NaN)).toBe(false);
  });
});

describe('correctForcedTop', () => {
  // Measured in a browser: static dialog inside translateY(-19px), asked for
  // 64, landed at 45.
  it('cancels the offset a transformed ancestor absorbs', () => {
    expect(correctForcedTop(64, 45)).toBe(83); // 83 - 19 == 64
  });

  it('handles an ancestor pushing the other way', () => {
    expect(correctForcedTop(64, 90)).toBe(38); // 38 + 26 == 64
  });

  it('returns null when it already landed correctly', () => {
    expect(correctForcedTop(64, 64)).toBeNull();
  });

  it('returns null rather than writing NaN into a style', () => {
    expect(correctForcedTop(64, NaN)).toBeNull();
    expect(correctForcedTop(NaN, 45)).toBeNull();
  });

  // A parent translated far enough would otherwise put the title back
  // off-screen -- the failure this exists to prevent.
  it('rescues a case the uncorrected escalation would still leave clipped', () => {
    const landed = -36; // asked for 64 inside translateY(-100px)
    const fix = correctForcedTop(64, landed);
    expect(fix).toBe(164);
    expect(fix! - 100).toBe(64); // lands on target
  });
});

/**
 * Verified in a browser at viewport 711 against three geometries. A and B both
 * end at exactly top:64 with the title row clickable and Send reachable:
 *
 *   A  absolute dialog, top -19          -> "gentle"  -> 64
 *   B  static dialog in translateY(-19)  -> "forced"  -> 64 (needed correction)
 *   C  static dialog in translateY(-140) -> "no-op"   -> unchanged
 *
 * B is the one that matters: the gentle path did nothing there, because `top`
 * is ignored on a statically-positioned element. Scheduling alone would have
 * shipped broken a third time.
 */
describe('deliberate limits of the rescue', () => {
  // C above. Its bottom sits ABOVE the fold, so it reads as an inline reply.
  it('ignores a clipped dialog whose bottom is above the fold', () => {
    expect(planComposeTitleRescue(-140, 695, 711)).toBeNull();
  });

  /**
   * Do not "fix" the case above by loosening the floating test. An inline reply
   * lives in the scrolling thread -- it is off-screen only until you scroll, and
   * repositioning it would be a new bug for every user, to chase a geometry
   * Gmail does not produce. Drishti's measured dialog ran to y=816 in a 711
   * viewport, well below the fold, which the narrow test catches.
   */
  it('keeps an inline reply untouched no matter how far above the fold it is', () => {
    for (const bottom of [200, 400, 690, 706]) {
      expect(planComposeTitleRescue(-50, bottom, 711)).toBeNull();
    }
    expect(planComposeTitleRescue(-50, 707, 711)).not.toBeNull(); // at the fold
  });
});

/**
 * Verified on real Gmail, 4 Aug, at viewports 517 and 677: the cap lowers the
 * dialog's TOP edge only. Gmail pins the bottom to the viewport bottom and Send
 * is the last row inside, so Send stayed visible (506 of 517; 666 of 677).
 *
 * v0.8.55 briefly shipped a scroll guard for a Send-below-the-fold case that
 * only ever appeared on a compose I had manually stripped and re-styled.
 * Removed in v0.8.56 -- see the note in lib/compose-title-rescue.
 */
describe('the cap cannot strand the Send button', () => {
  it('only ever lowers the top edge, never raises the bottom', () => {
    const plan = planComposeTitleRescue(-147, 711, 711)!;
    expect(plan.top).toBe(COMPOSE_SAFE_TOP);
    // The plan carries no bottom, no height and no transform -- nothing that
    // could move the pinned bottom edge Send sits on.
    expect(Object.keys(plan).sort()).toEqual(['maxHeight', 'top']);
  });
});
