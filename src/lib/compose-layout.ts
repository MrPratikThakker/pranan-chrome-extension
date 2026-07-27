/**
 * Geometry for keeping Pranan's injected compose bar out of Gmail's way.
 *
 * WHY THIS EXISTS
 * ---------------
 * Gmail sizes the compose window itself and does NOT re-flow when a third
 * party inserts a node into it. Anything we add in normal flow pushes the
 * bottom toolbar row -- the row that holds Send -- down by exactly our own
 * height. Measured live in a maximised compose (viewport 767px):
 *
 *     with the bar in flow     Send bottom = 825   (off-screen, unreachable)
 *     with the bar removed     Send bottom = 749   (visible)
 *                              ------------------
 *                              difference  =  76   == the bar's own height
 *
 * Reported twice by testers: "unable to access the send button ... the
 * placement is skewed due to the addition of the Pranan bar" (2026-07-23) and
 * "if the draft box is maximized, the send button disappears" (2026-07-27).
 *
 * THE FIX
 * -------
 * Take the bar out of flow and pin it just above Gmail's send toolbar. Gmail's
 * own layout is then byte-identical to vanilla, so Send lands exactly where
 * Gmail put it and no compose state can hide it.
 *
 * Everything here is pure so it can be tested without a browser.
 */

export interface BoxRect {
  top: number;
  bottom: number;
  height: number;
}

/** Vertical gap between our bar and Gmail's send toolbar. */
export const BAR_GAP_PX = 6;

/** Gap between the intent chips row and the bar above it. */
export const CHIPS_GAP_PX = 4;

/**
 * Bottom offset, in px, that pins an out-of-flow element just above the send
 * row. Both rects are viewport coordinates, so this holds regardless of which
 * ancestor ends up being the containing block -- `bottom: N` places the element
 * N px above the host's bottom edge, and host.bottom - sendRow.top is exactly
 * that distance.
 *
 * Clamped at 0: a negative offset would push the bar below the compose.
 */
export function bottomOffsetAboveSendRow(
  host: BoxRect,
  sendRow: BoxRect,
  gap: number = BAR_GAP_PX
): number {
  return Math.max(0, Math.round(host.bottom - sendRow.top) + gap);
}

/** Bottom offset for the chips row so it stacks directly above the bar. */
export function bottomOffsetForChips(
  barBottomOffset: number,
  barHeight: number,
  gap: number = CHIPS_GAP_PX
): number {
  return Math.max(0, Math.round(barBottomOffset + barHeight + gap));
}

/**
 * Is Gmail's Send control fully within the viewport?
 *
 * A zero-height rect means the compose is collapsed or mid-animation; that is
 * not "reachable", but it is also not our doing -- callers treat it as unknown
 * and simply leave the bar hidden until the compose settles.
 */
export function isSendReachable(
  send: BoxRect | null | undefined,
  viewportHeight: number
): boolean {
  if (!send || send.height <= 0) return false;
  return send.top >= 0 && send.bottom <= viewportHeight;
}

/**
 * Safety net. Our UI must never be the reason a user cannot send an email.
 *
 * Because the bar is out of flow by the time this runs, hiding it cannot move
 * Send -- so this never oscillates. It only declutters a compose that is
 * already too short to show its own controls.
 */
export function shouldHideBar(
  send: BoxRect | null | undefined,
  viewportHeight: number
): boolean {
  return !isSendReachable(send, viewportHeight);
}

/**
 * One corrective pass after the bar has been positioned.
 *
 * `bottomOffsetAboveSendRow` assumes the bar's containing block is the host we
 * measured. Gmail rebuilds the compose on full-screen toggle and the offset
 * parent is not always the node we started from, so the first placement can
 * land a few px low and overlap Send. Rather than model every layout, measure
 * what actually happened and correct by the observed overlap.
 *
 * Returns the corrected offset, or null when no correction is needed.
 */
export function correctedBottomOffset(
  currentOffset: number,
  barRect: BoxRect,
  sendRow: BoxRect,
  gap: number = BAR_GAP_PX
): number | null {
  const overlap = Math.round(barRect.bottom - sendRow.top) + gap;
  if (overlap <= 0) return null;
  return currentOffset + overlap;
}
