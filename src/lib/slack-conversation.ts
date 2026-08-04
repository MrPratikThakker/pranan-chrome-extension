/**
 * Telling a Slack DM from a Slack channel.
 *
 * Getting this wrong is why drafts in the pilot channel opened with
 * "Hi goal26-ancil-ai-launch," — the channel slug greeted as if it were a
 * person.
 *
 * The old check looked at the URL for a DM id, and if it did not find one it
 * fell through to guessing from the DOM:
 *
 *   - "the header text starts with #, so it is a channel"
 *   - "channels show a member count, DMs do not"
 *
 * Both are false. Measured on #goal26-ancil-ai-launch, 4 Aug 2026:
 *
 *   [data-qa="channel_name"]  ->  "goal26-ancil-ai-launch"   (no "#")
 *   member count element      ->  absent
 *
 * So a channel failed both tests, was declared a DM, and its slug was handed
 * onward as the recipient's name.
 *
 * The URL already carries the answer and does not need guessing at: Slack
 * conversation ids are prefixed by type. Read it, and only fall back to the DOM
 * when the URL genuinely does not say (a thread pane, a search view, a permalink
 * still resolving).
 */

export type SlackConversationKind = 'dm' | 'channel' | 'unknown';

/**
 * @param pathname window.location.pathname, e.g. "/client/T045HMRNS7L/C0AU31GRUDU"
 *
 * C… public or private channel
 * D… 1:1 direct message
 * G… group DM (legacy private channels also used G, and are read as DMs here —
 *    they behave like a small group conversation for greeting purposes)
 */
export function conversationKindFromUrl(pathname: string): SlackConversationKind {
  if (typeof pathname !== 'string') return 'unknown';

  // Must be a real Slack conversation id, not a view name. Slack ids are
  // uppercase, a type letter followed by 8-10 alphanumerics: T045HMRNS7L,
  // C0AU31GRUDU. Matching loosely reads the literal view name in
  // "/client/T045HMRNS7L/dms" as a D-prefixed DM id — caught live on 4 Aug,
  // where it happened to give the right answer for the wrong reason. Case
  // sensitivity is doing real work here; do not add the `i` flag.
  const match = pathname.match(/\/client\/T[A-Z0-9]{7,}\/([CDG][A-Z0-9]{7,})/);
  if (!match) return 'unknown';

  const id = match[1];
  if (id.startsWith('D') || id.startsWith('G')) return 'dm';
  if (id.startsWith('C')) return 'channel';
  return 'unknown';
}
