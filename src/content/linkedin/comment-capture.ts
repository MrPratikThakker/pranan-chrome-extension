/**
 * Did LinkedIn actually post this comment?
 *
 * Audit EXT-03: voice capture fired on Enter, and Enter in a comment editor
 * often just starts a new line, so unposted drafts were stored as voice
 * samples. A comment counts as posted only when BOTH are true:
 *
 *  - LinkedIn has cleared the editor (it does this after a successful post),
 *  - the same text now appears in the post's comment list.
 */

function normalize(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isConfirmedCommentPost(args: {
  editor: HTMLElement;
  scope: Element;
  text: string;
  editorText: string;
}): boolean {
  if (normalize(args.editorText)) return false;
  if (!args.scope.isConnected) return false;
  const needle = normalize(args.text).slice(0, 80);
  if (!needle) return false;
  const rendered = (args.scope as HTMLElement).innerText ?? args.scope.textContent ?? '';
  return normalize(rendered).includes(needle);
}
