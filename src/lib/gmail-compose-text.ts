export const MAX_COMPOSE_DRAFT_CHARS = 12_000;

/** Read only the supplied editor, stopping before Gmail's quoted reply history. */
export function readGmailComposeText(body: HTMLElement): string {
  // The insertion helper returns the quote's top-level ancestor. Reading must
  // stop at the actual quote: that ancestor can also contain the user's draft.
  const quote = body.querySelector('.gmail_quote, blockquote.gmail_quote, [class*="gmail_quote"]');
  let reachedQuote = false;
  const blockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE']);
  const read = (node: Node): string => {
    if (reachedQuote) return '';
    if (node === quote) {
      reachedQuote = true;
      return '';
    }
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (['SCRIPT', 'STYLE'].includes(node.tagName) || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
    if (node.tagName === 'BR') return '\n';
    let text = '';
    for (const child of Array.from(node.childNodes)) {
      text += read(child);
      if (reachedQuote) break;
    }
    return blockTags.has(node.tagName) ? `\n${text}\n` : text;
  };
  let text = '';
  for (const node of Array.from(body.childNodes)) {
    text += read(node);
    if (reachedQuote) break;
  }
  return text.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
