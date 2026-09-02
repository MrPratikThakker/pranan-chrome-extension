import { findGmailQuoteBlock } from './safe-dom';

export const MAX_COMPOSE_DRAFT_CHARS = 12_000;

/** Read only the supplied editor, stopping before Gmail's quoted reply history. */
export function readGmailComposeText(body: HTMLElement): string {
  const quote = findGmailQuoteBlock(body);
  const blockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE']);
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (['SCRIPT', 'STYLE'].includes(node.tagName) || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
    if (node.tagName === 'BR') return '\n';
    const text = Array.from(node.childNodes).map(read).join('');
    return blockTags.has(node.tagName) ? `\n${text}\n` : text;
  };
  let text = '';
  for (const node of Array.from(body.childNodes)) {
    if (node === quote) break;
    text += read(node);
  }
  return text.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
