import { describe, it, expect } from 'vitest';
import { formatThreadContext, extractSelfEmail } from '../src/lib/thread-context';

/**
 * The measured failure, from Pratik's "VC/Accelerator Discount Redemption
 * Request" thread with a Fathom account executive, 29 Jul 2026, v0.8.42.
 *
 * Pratik is the BUYER. He asked Fathom: "Can we do $15/user/month paid annually
 * if we do 65 users?" — and that was the newest message in the thread, sent by
 * him. Pranan drafted:
 *
 *     "Yes, we can offer $15/user/month paid annually for 65 users."
 *
 * It replied to Pratik's own message, in the seller's voice, committing to a
 * price from the wrong side of a live negotiation.
 *
 * The cause is not the model. getThreadContext concatenated the last three
 * message bodies with `---` between them and NO sender attribution at all, so
 * there was nothing in the prompt that could distinguish the user's own words
 * from the counterparty's. The model did the only sensible thing with what it
 * was given: answered the last thing it saw.
 *
 * This is the same defect that was fixed on the digest side, where a thread was
 * represented by its newest row and that row turned out to be the user's own
 * Pranan draft.
 */
describe('formatThreadContext', () => {
  it('attributes every message to its sender', () => {
    const out = formatThreadContext(
      [
        { sender: 'grace.robinson@fathom.video', text: 'Happy to discuss pricing.' },
        { sender: 'pratik@insidea.com', text: 'Can we do $15/user/month?' },
      ],
      'pratik@insidea.com',
    );
    expect(out).toContain('grace.robinson@fathom.video');
    expect(out).toContain('Happy to discuss pricing.');
    expect(out).toContain('Can we do $15/user/month?');
  });

  // The whole point: the user's own messages must be unmistakable, so the model
  // never answers them as if it were the other side.
  it('marks the user\'s own messages as theirs, not as the counterparty', () => {
    const out = formatThreadContext(
      [{ sender: 'pratik@insidea.com', text: 'Can we do $15/user/month?' }],
      'pratik@insidea.com',
    );
    expect(out).toMatch(/you/i);
    expect(out).not.toContain('pratik@insidea.com');
  });

  it('matches the user regardless of case or display formatting', () => {
    const out = formatThreadContext(
      [{ sender: 'Pratik Thakker <PRATIK@insidea.com>', text: 'Following up.' }],
      'pratik@insidea.com',
    );
    expect(out).toMatch(/you/i);
  });

  // The exact shape of the measured thread: the newest message is the user's.
  it('makes the buyer/seller roles recoverable in the measured thread', () => {
    const out = formatThreadContext(
      [
        { sender: 'grace.robinson@fathom.video', text: 'Account Executive at Fathom. Here is our pricing.' },
        { sender: 'pratik@insidea.com', text: 'Can we do $15/user/month paid annually if we do 65 users?' },
      ],
      'pratik@insidea.com',
    );
    // The ask must be attributed to the user, and the vendor's message to the vendor.
    const askIdx = out.indexOf('Can we do $15');
    const youIdx = out.lastIndexOf('you', askIdx);
    const vendorIdx = out.indexOf('grace.robinson@fathom.video');
    expect(youIdx).toBeGreaterThan(vendorIdx);
    expect(askIdx).toBeGreaterThan(youIdx);
  });

  it('keeps working when a sender cannot be identified', () => {
    const out = formatThreadContext([{ sender: null, text: 'Orphan message.' }], 'pratik@insidea.com');
    expect(out).toContain('Orphan message.');
  });

  it('drops empty bodies rather than emitting a bare label', () => {
    const out = formatThreadContext(
      [
        { sender: 'a@x.com', text: '   ' },
        { sender: 'b@x.com', text: 'Real content.' },
      ],
      null,
    );
    expect(out).toContain('Real content.');
    expect(out).not.toContain('a@x.com');
  });

  it('returns null when there is nothing to say', () => {
    expect(formatThreadContext([], 'me@x.com')).toBeNull();
    expect(formatThreadContext([{ sender: 'a@x.com', text: '' }], 'me@x.com')).toBeNull();
  });
});

describe('extractSelfEmail', () => {
  // Gmail's title is "<subject> - <your address> - <account name>".
  it('reads the signed-in address out of the Gmail title', () => {
    expect(extractSelfEmail('VC/Accelerator Discount Redemption Request - pratik@insidea.com - INSIDEA Mail'))
      .toBe('pratik@insidea.com');
  });

  it('handles the inbox title with no subject', () => {
    expect(extractSelfEmail('Inbox (107) - pratik@insidea.com - INSIDEA Mail')).toBe('pratik@insidea.com');
  });

  // A subject can itself contain an address; the account one is the LAST match,
  // because Gmail always appends it after the subject.
  it('picks the account address, not one quoted in the subject', () => {
    expect(extractSelfEmail('Fwd: contact grace@fathom.video about this - pratik@insidea.com - INSIDEA Mail'))
      .toBe('pratik@insidea.com');
  });

  it('returns null when the title carries no address', () => {
    expect(extractSelfEmail('Gmail')).toBeNull();
    expect(extractSelfEmail('')).toBeNull();
  });
});
