/**
 * Safe DOM construction for draft text injection.
 *
 * Replaces `node.innerHTML = userText.split('\n').map(...).join('')`
 * across content scripts. The draft text is server-generated (our
 * own backend) so the present risk is low, but defense-in-depth: the
 * moment the model paraphrases attacker-controlled content from an
 * email body, untrusted HTML reaches the editor. Using textContent
 * with explicit BR + element creation closes that vector forever.
 */

/**
 * Replaces the children of `node` with one block per line of `text`.
 * - Each non-empty line becomes a `<tag>line</tag>` block (tag defaults to 'div').
 * - Each empty line becomes a `<tag><br></tag>` block to preserve spacing.
 * - Line text is set via `textContent`, never `innerHTML`, so HTML
 *   in the source is rendered as literal text.
 */
export function injectMultilineText(
  node: HTMLElement,
  text: string,
  tag: 'div' | 'p' = 'div',
): void {
  // Clear existing children safely.
  while (node.firstChild) node.removeChild(node.firstChild);

  const lines = (text || '').split('\n');
  for (const line of lines) {
    const block = document.createElement(tag);
    if (!line) {
      block.appendChild(document.createElement('br'));
    } else {
      block.textContent = line;
    }
    node.appendChild(block);
  }
}


/**
 * Find the Gmail quoted-thread element inside a reply compose body, returning
 * the TOP-LEVEL child of `body` that contains it (so we can insert a draft
 * before the entire quoted block). Returns null for a new compose (no quote).
 *
 * Gmail wraps reply history in `.gmail_quote` (a div with the "On <date> X
 * wrote:" line) and/or `blockquote.gmail_quote`. The quote can be nested a few
 * levels under the contenteditable body, so we walk up to body's direct child.
 */
export function findGmailQuoteBlock(body: HTMLElement): HTMLElement | null {
  const quote = body.querySelector('.gmail_quote, blockquote.gmail_quote, [class*="gmail_quote"]') as HTMLElement | null;
  if (!quote) return null;
  let node: HTMLElement = quote;
  while (node.parentElement && node.parentElement !== body) {
    node = node.parentElement;
  }
  return node.parentElement === body ? node : null;
}

/**
 * Insert one block per line of `text` immediately BEFORE `beforeEl`, removing
 * only the nodes that precede `beforeEl` (the empty compose placeholder), and
 * leaving `beforeEl` and everything after it (the quoted thread) intact.
 *
 * QA fix (2026-06-12): the old path cleared the whole compose body, wiping the
 * Gmail quoted thread. Newly-added recipients (e.g. a CC'd colleague) then got
 * the reply with no conversation history. This preserves the quote.
 */
export function injectMultilineTextBefore(
  node: HTMLElement,
  text: string,
  beforeEl: HTMLElement,
  tag: 'div' | 'p' = 'div',
): void {
  // Remove only the nodes before the quote block (the empty placeholder /
  // prior typed content), never the quote itself or anything after it.
  while (node.firstChild && node.firstChild !== beforeEl) {
    node.removeChild(node.firstChild);
  }
  const lines = (text || '').split('\n');
  for (const line of lines) {
    const block = document.createElement(tag);
    if (!line) {
      block.appendChild(document.createElement('br'));
    } else {
      block.textContent = line;
    }
    node.insertBefore(block, beforeEl);
  }
  // A spacer line between the draft and the quoted "On <date> wrote:" header.
  const spacer = document.createElement(tag);
  spacer.appendChild(document.createElement('br'));
  node.insertBefore(spacer, beforeEl);
}
