/**
 * Pure helper for the Slack prompt-bar context key.
 *
 * Background (QA 2026-06-12): Slack is an SPA. When the user switches
 * conversations, the message input frequently re-renders BEFORE the header
 * DOM updates, so the first inject after navigation can read the PREVIOUS
 * conversation's recipient. The old dedupe guard returned early whenever any
 * Pranan bar existed, which froze that stale bar in place — every
 * conversation then showed the previous one's recipient (an off-by-one).
 *
 * The fix stamps each bar with the context key it was built for and only
 * keeps an existing bar when the key still matches the live conversation.
 * This helper is the single source of truth for that key so the inject path
 * and any test agree on it.
 */
export function slackContextKey(
  isDM: boolean,
  recipientName: string | null,
  channelName: string | null,
): string {
  return isDM ? `dm:${recipientName || ''}` : `ch:${channelName || ''}`;
}

/**
 * Whether an existing bar stamped with `existingKey` must be torn down and
 * rebuilt because the live conversation (`currentKey`) no longer matches.
 */
export function slackBarIsStale(
  existingKey: string | null,
  currentKey: string,
): boolean {
  return existingKey !== currentKey;
}
