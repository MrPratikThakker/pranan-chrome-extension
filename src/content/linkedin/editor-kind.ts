/** LinkedIn reuses TipTap for posts, comments and messages. The wrapper alone is insufficient. */
export const LINKEDIN_POST_EDITOR = '[componentkey="ShareBox_textEditor"][contenteditable="true"]';
export function isLinkedInPostEditor(editor: Element): boolean {
  return editor.matches(LINKEDIN_POST_EDITOR) || !!editor.closest('.share-creation-state__text-editor') || /creating post/i.test(editor.getAttribute('aria-label') || '');
}
export function isLinkedInCommentCandidate(editor: Element): boolean {
  return !isLinkedInPostEditor(editor) && !editor.closest('.msg-form') && !/write a message/i.test(editor.getAttribute('aria-label') || '');
}
export function findLinkedInPostButton(editor: Element | null): HTMLElement | null {
  const dialog = editor?.closest('[role="dialog"]');
  return [...(dialog?.querySelectorAll('button') || [])].find(button => button.textContent?.trim() === 'Post') || null;
}
