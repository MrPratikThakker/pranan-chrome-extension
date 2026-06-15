/**
 * Regression (QA 2026-06-12): draft injection must NOT wipe the Gmail quoted
 * thread on a reply. The old injectMultilineText cleared the whole compose
 * body, so a newly-added CC recipient received the reply with no conversation
 * history. injectMultilineTextBefore must insert the draft above the quote and
 * leave the quote intact.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  injectMultilineText,
  injectMultilineTextBefore,
  findGmailQuoteBlock,
} from '../src/lib/safe-dom';

function gmailReplyBody(): HTMLElement {
  const body = document.createElement('div');
  body.setAttribute('contenteditable', 'true');
  body.setAttribute('aria-label', 'Message Body');
  // Empty placeholder Gmail puts where you type
  const placeholder = document.createElement('div');
  placeholder.appendChild(document.createElement('br'));
  body.appendChild(placeholder);
  // The quoted thread
  const quote = document.createElement('div');
  quote.className = 'gmail_quote';
  quote.innerHTML = '<div>On Mon, Jun 15, 2026, Valerie wrote:</div><blockquote class="gmail_quote">Congratulations on closing On Track School!</blockquote>';
  body.appendChild(quote);
  return body;
}

describe('Gmail quote preservation', () => {
  it('finds the quote block as a direct child of the body', () => {
    const body = gmailReplyBody();
    const q = findGmailQuoteBlock(body);
    expect(q).not.toBeNull();
    expect(q!.className).toContain('gmail_quote');
  });

  it('inserts the draft above the quote and KEEPS the quoted thread', () => {
    const body = gmailReplyBody();
    const quote = findGmailQuoteBlock(body)!;
    injectMultilineTextBefore(body, 'Hi Valerie,\n\nThanks for the introduction.', quote, 'div');

    const text = body.textContent || '';
    // Draft is present
    expect(text).toContain('Hi Valerie,');
    expect(text).toContain('Thanks for the introduction.');
    // Quoted thread SURVIVES
    expect(text).toContain('Congratulations on closing On Track School!');
    expect(body.querySelector('.gmail_quote')).not.toBeNull();
    // Draft comes before the quote in document order
    const html = body.innerHTML;
    expect(html.indexOf('Thanks for the introduction')).toBeLessThan(html.indexOf('gmail_quote'));
  });

  it('the OLD full-clear path would have wiped the quote (documents the bug)', () => {
    const body = gmailReplyBody();
    injectMultilineText(body, 'Hi Valerie,', 'div');
    // Proves why we stopped using it on replies:
    expect(body.querySelector('.gmail_quote')).toBeNull();
    expect((body.textContent || '')).not.toContain('Congratulations');
  });

  it('new compose with no quote returns null (caller falls back to full write)', () => {
    const body = document.createElement('div');
    body.appendChild(document.createElement('div'));
    expect(findGmailQuoteBlock(body)).toBeNull();
  });
});
