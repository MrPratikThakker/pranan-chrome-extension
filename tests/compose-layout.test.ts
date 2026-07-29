import { describe, it, expect } from 'vitest';
import { bottomOffsetAboveSendRow, bottomOffsetForChips, isSendReachable, shouldHideBar, BAR_GAP_PX, correctedBottomOffset, verticalOverlapPx, placementObscuresCompose } from '../src/lib/compose-layout';

const rect = (top: number, height: number) => ({ top, height, bottom: top + height });

describe('bottomOffsetAboveSendRow', () => {
  it('pins the bar just above the send row', () => {
    // host runs to y=804, send row starts at y=676 -> bar must sit 128+gap up
    const offset = bottomOffsetAboveSendRow(rect(40, 764), rect(676, 60));
    expect(offset).toBe(804 - 676 + BAR_GAP_PX);
  });

  it('never returns a negative offset', () => {
    // pathological: send row below the host entirely
    expect(bottomOffsetAboveSendRow(rect(0, 100), rect(400, 60))).toBe(0);
  });
});

describe('bottomOffsetForChips', () => {
  it('stacks the chips row directly above the bar', () => {
    expect(bottomOffsetForChips(134, 60)).toBe(134 + 60 + 4);
  });
});

describe('isSendReachable', () => {
  const VH = 767;

  it('accepts a send button fully inside the viewport', () => {
    expect(isSendReachable(rect(687, 36), VH)).toBe(true);
  });

  // The exact geometry Drishti and Ancil hit: maximised compose, Send pushed
  // past the fold by the height of our own bar.
  it('rejects the measured maximised-compose failure (send bottom 825 of 767)', () => {
    expect(isSendReachable(rect(789, 36), VH)).toBe(false);
  });

  it('rejects a send button clipped off the top', () => {
    expect(isSendReachable(rect(-10, 36), VH)).toBe(false);
  });

  it('treats a collapsed (zero-height) compose as not reachable', () => {
    expect(isSendReachable(rect(700, 0), VH)).toBe(false);
    expect(isSendReachable(null, VH)).toBe(false);
  });

  it('accepts a send button flush against the bottom edge', () => {
    expect(isSendReachable(rect(731, 36), VH)).toBe(true);
  });
});

describe('shouldHideBar', () => {
  const VH = 767;

  it('keeps the bar when Send is reachable', () => {
    expect(shouldHideBar(rect(687, 36), VH)).toBe(false);
  });

  it('hides the bar rather than let Send stay unreachable', () => {
    expect(shouldHideBar(rect(789, 36), VH)).toBe(true);
  });

  // Regression guard for the whole point of this module: once the bar is out
  // of flow, hiding it cannot move Send, so the decision is stable across
  // repeated evaluation and can never flip-flop.
  it('is stable under repeated evaluation (no oscillation)', () => {
    const send = rect(789, 36);
    const first = shouldHideBar(send, VH);
    expect(shouldHideBar(send, VH)).toBe(first);
    expect(shouldHideBar(send, VH)).toBe(first);
  });
});

describe('correctedBottomOffset', () => {
  const rect2 = (top: number, height: number) => ({ top, height, bottom: top + height });

  it('returns null when the bar already clears the send row', () => {
    // bar ends at 670, send row starts at 676 -> 6px gap, exactly right
    expect(correctedBottomOffset(99, rect2(610, 60), rect2(676, 60))).toBe(null);
  });

  // The overlap seen live after a full-screen toggle: bar painted on top of Send.
  it('lifts the bar by the observed overlap', () => {
    // bar ends at 710, send row starts at 703 -> 7px over, +6 gap = 13
    expect(correctedBottomOffset(57, rect2(666, 44), rect2(703, 60))).toBe(57 + 13);
  });

  it('is idempotent once corrected', () => {
    const first = correctedBottomOffset(57, rect2(666, 44), rect2(703, 60))!;
    // after moving up by 13 the bar now ends at 697, clearing 703 by 6
    expect(correctedBottomOffset(first, rect2(653, 44), rect2(703, 60))).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// The requirement none of the above encoded: never cover the compose.
// Numbers are the real ones measured in Pratik's Chrome on 29 Jul 2026 with
// v0.8.34 installed, on an inline Gmail reply.
// ---------------------------------------------------------------------------
describe('placementObscuresCompose', () => {
  const MEASURED_BAR = { top: 668, bottom: 762 };
  const MEASURED_EDITOR = { top: 599, bottom: 684 };
  const MEASURED_SEND = { top: 738, bottom: 774 };

  it('rejects the v0.8.34 placement that shipped to every user', () => {
    expect(verticalOverlapPx(MEASURED_BAR, MEASURED_EDITOR)).toBe(16);
    expect(verticalOverlapPx(MEASURED_BAR, MEASURED_SEND)).toBe(24);
    expect(placementObscuresCompose(MEASURED_BAR, MEASURED_EDITOR, MEASURED_SEND)).toBe(true);
  });

  it('accepts a bar sitting wholly above the compose, which is where it belongs', () => {
    const above = { top: 500, bottom: 594 };
    expect(placementObscuresCompose(above, MEASURED_EDITOR, MEASURED_SEND)).toBe(false);
  });

  it('accepts a bar tucked between the editor and Send when there is room', () => {
    const between = { top: 690, bottom: 730 };
    expect(placementObscuresCompose(between, MEASURED_EDITOR, MEASURED_SEND)).toBe(false);
  });

  it('counts a one-pixel clip as covering, because it is', () => {
    expect(placementObscuresCompose({ top: 683, bottom: 700 }, MEASURED_EDITOR, MEASURED_SEND)).toBe(true);
  });

  it('is safe when a rect is missing rather than guessing', () => {
    expect(verticalOverlapPx(null, MEASURED_EDITOR)).toBe(0);
    expect(placementObscuresCompose(MEASURED_BAR, null, null)).toBe(false);
  });
});
