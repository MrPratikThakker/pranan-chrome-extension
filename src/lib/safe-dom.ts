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

  // A <p> already carries a margin, so an extra empty paragraph for each blank
  // line adds a SECOND gap on top of it. Slack and LinkedIn pass 'p', and every
  // draft on those surfaces arrived with enormous holes in it — measured on
  // LinkedIn as "Hi Sahil,\n\n\n\n\nI'm doing well..." where the backend had
  // returned a clean "Hi Sahil,\n\nI'm doing well...".
  //
  // A <div> has no margin, so there the empty block IS the blank line. That is
  // why Gmail always looked right, and why this stays tag-aware rather than
  // dropping empties everywhere.
  const lines = (text || '').split('\n');
  const blocks = tag === 'p' ? lines.filter((line) => line.trim().length > 0) : lines;

  for (const line of blocks) {
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

/**
 * Normalize server-generated draft text for insertion into a plain-text editor.
 * Gmail compose renders our textContent literally, so Markdown emphasis showed
 * up as raw characters (founding-tester report, Swapnali S. 2026-07-20: drafts
 * arrived with **bold** and "- " bullets as literal text).
 *
 * Conservative on purpose: strips bold and inline-code markers, converts
 * Markdown bullets to a glyph, flattens ATX headings, and turns [label](url)
 * into "label (url)". Single * and _ are left untouched so filenames, emails,
 * and snake_case tokens are never mangled.
 */
export function normalizeDraftForPlainText(text: string): string {
  if (!text) return text;
  const lines = text.split('\n').map((line) => {
    // Markdown bullets ("- ", "* ", "+ ") -> bullet glyph, preserving indent.
    let out = line.replace(/^(\s*)[-*+]\s+/, '$1• ');
    // ATX headings ("# ", "## ", ...) -> plain line.
    out = out.replace(/^(\s*)#{1,6}\s+/, '$1');
    return out;
  });
  let out = lines.join('\n');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1'); // **bold** -> bold
  out = out.replace(/__(.+?)__/g, '$1');     // __bold__ -> bold
  out = out.replace(/`([^`]+)`/g, '$1');     // `code` -> code
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)'); // [label](url)
  out = out.replace(/\*\*/g, '');            // any leftover bold markers
  return out;
}

/** Preserve Gmail's signature and quoted history when replacing authored text. */
export function findGmailPreservedBlock(body: HTMLElement): HTMLElement | null {
  const preserved = body.querySelector('.gmail_signature, [data-smartmail="gmail_signature"], .gmail_quote, [class*="gmail_quote"]');
  if (!(preserved instanceof HTMLElement)) return null;
  let root = preserved;
  while (root.parentElement && root.parentElement !== body) root = root.parentElement;
  return root.parentElement === body ? root : null;
}
