import { it, expect } from 'vitest';
import { LINKEDIN_POST_EDITOR, isLinkedInCommentCandidate, findLinkedInPostButton } from '../src/content/linkedin/editor-kind';
it('recognizes the current ShareBox post editor despite its generic TipTap wrapper', () => {
  const container = document.createElement('div');
  container.innerHTML = '<div role="dialog"><div data-testid="ui-core-tiptap-text-editor-wrapper"><div contenteditable="true" role="textbox" componentkey="ShareBox_textEditor"><p data-placeholder="Share your thoughts ..."></p></div></div><button disabled>Post</button></div>';
  const editor = container.querySelector(LINKEDIN_POST_EDITOR)!;
  expect(editor).not.toBeNull();
  expect(isLinkedInCommentCandidate(editor)).toBe(false);
  expect(findLinkedInPostButton(editor)?.textContent).toBe('Post');
});
it('keeps actual comment editors while excluding message and legacy post editors', () => {
  for (const [label, expected] of [['Text editor for creating comment', true], ['Text editor for creating post', false], ['Write a message', false]] as const) {
    const editor = document.createElement('div'); editor.setAttribute('aria-label', label);
    expect(isLinkedInCommentCandidate(editor)).toBe(expected);
  }
});
