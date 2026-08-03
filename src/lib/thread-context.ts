/**
 * Who said what, in the thread we hand to the model.
 *
 * getThreadContext used to concatenate the last three message bodies with
 * `---` between them and no attribution whatsoever. Nothing in that prompt
 * could distinguish the user's own words from the counterparty's, so when the
 * user had sent the most recent message the model answered it — as the other
 * side.
 *
 * Measured in Pratik's "VC/Accelerator Discount Redemption Request" thread with
 * a Fathom account executive, 29 Jul 2026, v0.8.42. Pratik is the buyer. He
 * asked "Can we do $15/user/month paid annually if we do 65 users?", and that
 * was the newest message, sent by him. Pranan drafted:
 *
 *     "Yes, we can offer $15/user/month paid annually for 65 users."
 *
 * — committing to a price from the wrong side of a live negotiation.
 *
 * This is not a model failure; it did the only sensible thing with what it was
 * given. It is the same defect fixed on the digest side, where a thread was
 * represented by its newest row and that row was the user's own Pranan draft.
 *
 * Following up on your own message is one of the most common reasons to want a
 * draft at all ("any update?", "checking in"), so this fires often.
 */

export interface ThreadMessage {
  /** Whatever the DOM gave us: a bare address, or "Name <address>". */
  sender: string | null;
  text: string;
}

/** Pull the bare address out of "Name <addr@host>" / "addr@host". */
function bareAddress(value: string): string {
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

/**
 * Label each message with its sender, and the user's own messages as "you".
 *
 * The user's address is deliberately replaced rather than shown: the model
 * needs to know which turns are the user's, and printing the address invites it
 * to write about the user in the third person.
 *
 * @returns the labelled transcript, or null when there is nothing to say.
 */
export function formatThreadContext(
  messages: ThreadMessage[],
  selfEmail: string | null,
): string | null {
  const self = selfEmail ? bareAddress(selfEmail) : null;

  const blocks = messages
    .filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 0)
    .map((m) => {
      // Compare normalised, but SHOW what the surface gave us. Slack and
      // LinkedIn senders are display names, and lowercasing them turned
      // "Grace Robinson" into "grace robinson" in the prompt. Addresses are
      // case-insensitive so Gmail is unaffected either way.
      const who = m.sender
        ? (self && bareAddress(m.sender) === self ? 'you' : m.sender.trim())
        : 'unknown sender';
      return `From: ${who}\n${m.text.trim()}`;
    });

  if (blocks.length === 0) return null;
  return blocks.join('\n\n---\n\n');
}

/**
 * The signed-in address, read from Gmail's document title.
 *
 * Gmail formats it "<subject> - <your address> - <account name>". The account
 * address is always the LAST one in the string, because Gmail appends it after
 * the subject — and a subject can contain an address of its own.
 */
export function extractSelfEmail(title: string | null | undefined): string | null {
  if (!title) return null;
  const matches = title.match(/[^\s<>()[\],;:]+@[^\s<>()[\],;:]+\.[a-z]{2,}/gi);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].toLowerCase();
}
