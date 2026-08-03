/**
 * Keeping Gmail's floating compose title bar reachable.
 *
 * Gmail anchors the "New Message" popup to the bottom of the viewport and grows
 * it upward. On a laptop-height screen the dialog wants more room than there
 * is, so its own title bar — minimise, pop-out, close — ends up above the top
 * of the screen and cannot be clicked.
 *
 * Reported by Drishti on 21 July 2026. Measured on her class of screen on
 * 1 Aug: viewport 711px, dialog needing ~880px, title bar at y = -19.
 *
 * This has been "fixed" twice already:
 *
 *   v0.8.33 added the rescue, guarded on position:fixed/absolute. Gmail's
 *           dialog computes to static, so the guard fired every time and the
 *           rescue never ran for anyone.
 *   v0.8.34 fixed the guard.
 *
 * What neither addressed is WHEN it runs. It was scheduled as one
 * requestAnimationFrame plus one 600ms timeout, both inside the first moments
 * after injection, while Gmail is still sizing the dialog — and then never
 * again. By the time the title bar is genuinely clipped, nothing is watching.
 * requestAnimationFrame does not fire in a background tab either, so one of the
 * two shots is routinely lost as well.
 *
 * The decision is pulled out here so it can be tested directly and so the
 * caller is free to re-run it on every mutation and resize, which is what it
 * needed all along. It must therefore be safe to call repeatedly against a
 * dialog it has already moved.
 */

/** Clears Gmail's top toolbar. */
export const COMPOSE_SAFE_TOP = 64;

export interface ComposeRescuePlan {
  top: number
  maxHeight: string
}

/**
 * @param dialogTop     the dialog's top edge, viewport-relative
 * @param dialogBottom  its bottom edge, used to tell a floating popup from an
 *                      inline reply — Gmail pins the popup to the viewport
 *                      bottom, an inline reply sits in the thread
 * @param viewportHeight window.innerHeight
 * @returns styles to apply, or null when nothing should be touched
 */
export function planComposeTitleRescue(
  dialogTop: number,
  dialogBottom: number,
  viewportHeight: number,
  safeTop: number = COMPOSE_SAFE_TOP,
): ComposeRescuePlan | null {
  if (!Number.isFinite(dialogTop) || !Number.isFinite(dialogBottom)) return null;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;

  // Only the popup Gmail anchors to the bottom of the viewport. A true inline
  // reply lives in the scrolling thread and must never be repositioned.
  const isFloating = dialogBottom >= viewportHeight - 4;
  if (!isFloating) return null;

  // Only a title bar that is genuinely off-screen. A maximised compose sits
  // high on purpose, and moving it would re-break the layout v0.8.34 fixed.
  if (dialogTop >= 0) return null;

  return {
    top: safeTop,
    maxHeight: `calc(100vh - ${safeTop + 16}px)`,
  };
}

/**
 * Did the gentle fix actually work?
 *
 * The plan above sets `top` and `max-height`. Neither is guaranteed to move
 * anything: `top` is ignored outright on a statically-positioned element, and
 * the v0.8.34 note in the Gmail content script records that Gmail's compose
 * dialog computes to `static`. `max-height` does apply, and on a dialog whose
 * layout is anchored to the bottom of the viewport, shrinking it is enough to
 * bring the title row back down into view. On a dialog anchored any other way
 * it changes nothing.
 *
 * Which of those describes Drishti's Gmail is not something I can establish
 * without her browser, and this rescue has now shipped twice on an assumption
 * that turned out to be wrong. So it measures instead of assuming: apply the
 * cheap, non-invasive change, re-read the box, and escalate only if the title
 * row is still out of reach.
 *
 * @param topAfterPlan the dialog's top edge re-measured after the plan was applied
 */
export function needsForcedPositioning(topAfterPlan: number): boolean {
  if (!Number.isFinite(topAfterPlan)) return false;
  return topAfterPlan < 0;
}

/**
 * `position: fixed` is not always relative to the viewport. Any ancestor with a
 * transform, filter, or perspective becomes the containing block for its fixed
 * descendants, so `top: 64px` lands 64px below THAT box instead.
 *
 * Measured in a browser against a static dialog inside a `translateY(-19px)`
 * parent -- the exact shape the v0.8.34 note describes: asking for 64 produced
 * 45. On that geometry the title row is still reachable so it looks fine, which
 * is precisely how this would ship broken a fourth time; a parent translated
 * further would put it back off-screen.
 *
 * Rather than hunt for the offending ancestor, measure the error once and
 * subtract it.
 *
 * @param desiredTop where the dialog should sit
 * @param actualTop  where it actually landed
 * @returns the value to write to `style.top`, or null if it already landed right
 */
export function correctForcedTop(desiredTop: number, actualTop: number): number | null {
  if (!Number.isFinite(desiredTop) || !Number.isFinite(actualTop)) return null;
  const error = actualTop - desiredTop;
  if (error === 0) return null;
  return desiredTop - error;
}

/**
 * Capping the dialog's height does not make its contents scroll.
 *
 * Measured on Pratik's Gmail at a 517px viewport, 4 Aug: the rescue set
 * max-height 437px, but the dialog computes `overflow-y: visible`, so its
 * content (500px) simply spilled out of the bottom. Send ended up 52px below
 * the fold with NO scrollable ancestor -- unreachable by any means.
 *
 * That is a straight downgrade of the bug being fixed. Drishti losing the Close
 * button is irritating; a user who cannot reach Send cannot send the mail at
 * all, and this file already carries the rule that our UI must never be why
 * Send is unreachable.
 *
 * So when the cap actually bites, the content has to be allowed to scroll.
 * Checked rather than applied unconditionally: `overflow-y: auto` on Gmail's
 * dialog risks clipping menus that intentionally paint outside it, and in the
 * common case -- verified at a 677px viewport, where the compose needs 500px --
 * nothing overflows and there is no reason to touch it.
 */
export function needsScrollableContent(scrollHeight: number, clientHeight: number): boolean {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return false;
  return scrollHeight > clientHeight + 2;
}
