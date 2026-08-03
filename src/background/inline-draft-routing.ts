/**
 * Which inline draft requests the worker handles itself.
 *
 * INLINE_DRAFT_REQUEST has two possible routes. The direct path generates in
 * the worker and pushes the result straight into the page. The other opens the
 * side panel, stashes a pending request and broadcasts it 500ms later — which
 * produces nothing at all if the panel is closed, because nothing is listening.
 *
 * The platform list was `gmail || slack`, and the comment above it said "Gmail
 * and LinkedIn were already migrated; Slack was the straggler." LinkedIn was
 * never in the list. Measured on live LinkedIn messaging, v0.8.48: pressed
 * Generate, and twenty-six seconds later the button still read "Generate", the
 * compose was empty, and no error had been shown. The comment described the
 * exact failure the code still had.
 *
 * LinkedIn comments were never affected because they travel as
 * COMMENT_DRAFT_REQUEST, whose gate carries no platform restriction — which is
 * why commenting worked in the same session that messaging silently did not.
 *
 * Kept as an explicit allow-list rather than "any platform": the direct path
 * ends in chrome.tabs.sendMessage expecting a content script that handles
 * INSERT_DRAFT. All three of these do; something we have not built does not,
 * and would fail silently in a new way.
 */

/** Surfaces whose content script implements the INSERT_DRAFT handler. */
const DIRECT_PATH_PLATFORMS = new Set(['gmail', 'slack', 'linkedin']);

export interface InlineDraftRouting {
  originSurface?: string
  platform?: string
}

export function usesDirectWorkerPath(
  payload: InlineDraftRouting | null | undefined,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.originSurface !== 'inline-bar') return false;
  return typeof payload.platform === 'string' && DIRECT_PATH_PLATFORMS.has(payload.platform);
}
