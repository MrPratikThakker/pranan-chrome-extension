/**
 * Who said what, on Slack and LinkedIn.
 *
 * Gmail's getThreadContext used to glue the last few messages together with
 * `---` and no sender on any of them. Nothing in that prompt could separate the
 * user's own words from the counterparty's, so the model answered whatever came
 * last — on a live pricing thread where Pratik (the buyer) had asked "Can we do
 * $15/user/month?", Pranan drafted "Yes, we can offer $15/user/month",
 * committing to a price from the wrong side. Fixed in v0.8.43.
 *
 * The other two surfaces were never touched and carried the same defect:
 *
 *   slack/index.ts    getThreadContext()   -> .map(textContent).join('\n---\n')
 *   linkedin/index.ts getMessageHistory()  -> .map(textContent).join('\n---\n')
 *
 * Slack is the sharper case, because getRecentChannelMessages() in the same
 * file already attributes correctly. Every draft call site prefers thread
 * context when a thread is open (`threadContext || channelContext`), so the
 * unattributed path is the one that wins whenever the user is replying in a
 * thread — which is most of the time.
 *
 * Both extractors reuse formatThreadContext, so all three surfaces now hand the
 * model the same shape.
 */

import { formatThreadContext } from '@/lib/thread-context';
import { findAll, findOne, SELECTORS } from '../selectors';

/** How many trailing messages to carry, matching the previous behaviour. */
const CONTEXT_MESSAGES = 5;
const MAX_CHARS = 2000;

/**
 * The signed-in user's display name, best effort.
 *
 * Neither surface exposes this reliably, and both rotate their markup, so this
 * is allowed to fail. When it returns null the transcript is still attributed
 * by sender name — the model can tell the turns apart, it just cannot be told
 * which are the user's. That is a smaller loss than the unattributed blob this
 * replaces, and it degrades quietly rather than guessing wrong.
 */
export function readSelfName(candidates: string[]): string | null {
  for (const selector of candidates) {
    try {
      const el = document.querySelector(selector);
      if (!el) continue;
      const raw =
        el.getAttribute('aria-label') ||
        el.getAttribute('alt') ||
        el.textContent ||
        '';
      // Slack renders "User menu: Pratik Thakker"; LinkedIn alt text is often
      // "Photo of Pratik Thakker". Take what follows the separator when present.
      const cleaned = raw.replace(/^.*?(?::|Photo of)\s*/i, '').trim();
      if (cleaned && cleaned.length < 80) return cleaned;
    } catch {
      /* selector rotated out; try the next */
    }
  }
  return null;
}

export const SLACK_SELF_NAME_SELECTORS = [
  '[data-qa="user-button"]',
  '.p-ia__nav__user__button',
  '[data-qa="user-profile-button"]',
];

export const LINKEDIN_SELF_NAME_SELECTORS = [
  '.global-nav__me-photo',
  'img.global-nav__me-photo',
  '.feed-identity-module__actor-meta a',
];

/**
 * The sender of a Slack message, found by climbing from its body.
 *
 * `body.closest(chain.join(', '))` looks right and is wrong: closest() returns
 * the NEAREST ancestor matching ANY selector in the list, so with a chain
 * containing both `.c-message_kit__message` and `.c-message_kit__blocks` it
 * lands on `.c-message_kit__blocks` — which sits INSIDE the element that holds
 * the sender button. The lookup then finds nothing and every message comes back
 * anonymous.
 *
 * Climbing one level at a time and stopping at the first ancestor that actually
 * contains a sender is immune to the ordering of the chain. Bounded so a miss
 * cannot walk out to the whole pane and attribute every message to whoever
 * happens to be first in it.
 */
export function findSenderFor(body: Element): string | null {
  let node: Element | null = body.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const senderEl = findOne('slack.messageSenderName', SELECTORS.slack.messageSenderName, node);
    const name = senderEl?.textContent?.trim();
    if (name) return name;
  }
  return null;
}

/**
 * Slack thread pane, attributed.
 *
 * @param selfName the signed-in user's display name, or null if unknown — in
 *                 which case turns are still labelled by sender, which is a
 *                 large improvement on labelling nothing.
 */
export function attributeSlackThread(selfName: string | null): string | null {
  const threadPane = findOne('slack.threadContainer', SELECTORS.slack.threadContainer);
  if (!threadPane) return null;

  const bodies = findAll('slack.threadMessageBody', SELECTORS.slack.threadMessageBody, threadPane);
  if (bodies.length === 0) return null;

  const messages = bodies.slice(-CONTEXT_MESSAGES).map((body: Element) => ({
    sender: findSenderFor(body),
    text: body.textContent?.trim() || '',
  }));

  const formatted = formatThreadContext(messages, selfName);
  return formatted ? formatted.slice(0, MAX_CHARS) : null;
}

/**
 * LinkedIn conversation history, attributed.
 *
 * LinkedIn groups consecutive messages from one person under a single name
 * heading, so the sender lives on the group rather than the message.
 */
export function attributeLinkedInHistory(
  selfName: string | null,
  // LinkedIn's selectors live in its own module rather than the shared
  // registry, so the caller passes its chain in instead of this reaching across.
  messageSelectors: string[] = [
    '.msg-s-message-list-content .msg-s-event-listitem__body',
    '.msg-s-message-group__content .msg-s-event-listitem__body',
  ],
): string | null {
  const bodies = Array.from(document.querySelectorAll(messageSelectors.join(', ')));
  if (bodies.length === 0) return null;

  const messages = bodies.slice(-CONTEXT_MESSAGES).map((body) => {
    const group = body.closest('.msg-s-message-group, .msg-s-event-listitem');
    const nameEl = group?.querySelector(
      '.msg-s-message-group__name, .msg-s-message-group__profile-link, .msg-s-event-listitem__name',
    );
    return {
      sender: nameEl?.textContent?.trim() || null,
      text: body.textContent?.trim() || '',
    };
  });

  const formatted = formatThreadContext(messages, selfName);
  return formatted ? formatted.slice(0, MAX_CHARS) : null;
}
