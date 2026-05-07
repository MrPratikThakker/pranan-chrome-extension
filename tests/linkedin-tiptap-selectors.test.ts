/**
 * Regression test for the LinkedIn 2026 TipTap migration.
 *
 * Bug reproduction: as of 2026-05-07, LinkedIn replaced their comment
 * composer with TipTap/ProseMirror. Class names are now obfuscated
 * hashes (.a2dd5017, ._2fcd7cb3, etc.). All v0.3.x selectors match
 * zero elements on the live page. Pranan can't find the input, so
 * no inline bar is injected.
 *
 * Verified via Chrome MCP DOM inspection on www.linkedin.com/feed.
 *
 * This test builds a synthetic DOM matching what LinkedIn renders today
 * and asserts that the v0.4.2 selectors find the comment input. Also
 * verifies the legacy 2024 selectors still work for unmigrated surfaces.
 */
import { describe, it, expect } from 'vitest';

describe('LinkedIn comment-composer selectors', () => {
  it('matches the 2026 TipTap-based comment editor', () => {
    document.body.innerHTML = `
      <div data-testid="ui-core-tiptap-text-editor-wrapper">
        <div class="some-wrapper">
          <div class="tiptap ProseMirror a2dd5017 _2fcd7cb3 _7ad8cbe5"
               role="textbox"
               contenteditable="true"
               aria-label="Text editor for creating comment"></div>
        </div>
      </div>
    `;

    // The new aria-label selector — primary path
    expect(document.querySelectorAll('[contenteditable="true"][aria-label*="comment" i]').length).toBe(1);
    expect(document.querySelectorAll('[role="textbox"][aria-label*="comment" i]').length).toBe(1);
    // The data-testid wrapper path — structural fallback
    expect(document.querySelectorAll('[data-testid="ui-core-tiptap-text-editor-wrapper"] [contenteditable="true"]').length).toBe(1);
    expect(document.querySelectorAll('[data-testid="ui-core-tiptap-text-editor-wrapper"] [role="textbox"]').length).toBe(1);
    // The legacy selectors should NOT match the new editor — confirms why
    // pre-v0.4.2 was finding nothing on the live site.
    expect(document.querySelectorAll('.comments-comment-texteditor [contenteditable="true"]').length).toBe(0);
    expect(document.querySelectorAll('.comments-comment-box__form [contenteditable="true"]').length).toBe(0);
    expect(document.querySelectorAll('.comments-comment-box [role="textbox"]').length).toBe(0);

    // closest() must find the TipTap wrapper as the form anchor
    const input = document.querySelector('[contenteditable="true"][aria-label*="comment" i]');
    expect(input).toBeTruthy();
    const form = input!.closest('[data-testid="ui-core-tiptap-text-editor-wrapper"], .comments-comment-box, .comments-comment-texteditor');
    expect(form).toBeTruthy();
    expect((form as HTMLElement).getAttribute('data-testid')).toBe('ui-core-tiptap-text-editor-wrapper');
  });

  it('still matches legacy 2024 surfaces (e.g., older reply contexts)', () => {
    document.body.innerHTML = `
      <div class="comments-comment-box">
        <div class="comments-comment-texteditor">
          <div class="comments-comment-box__form">
            <div role="textbox" contenteditable="true"></div>
          </div>
        </div>
      </div>
    `;

    // Legacy selectors must still match unmigrated surfaces
    expect(document.querySelectorAll('.comments-comment-texteditor [contenteditable="true"]').length).toBe(1);
    expect(document.querySelectorAll('.comments-comment-box [role="textbox"]').length).toBe(1);

    // closest() resolves to the legacy form wrapper
    const input = document.querySelector('[contenteditable="true"]');
    expect(input).toBeTruthy();
    const form = input!.closest('[data-testid="ui-core-tiptap-text-editor-wrapper"], .comments-comment-box, .comments-comment-texteditor');
    expect(form).toBeTruthy();
    expect((form as HTMLElement).className).toContain('comments-comment-texteditor');
  });

  it('does NOT match unrelated text editors (post composer, message thread)', () => {
    // The TipTap framework is also used by LinkedIn's post composer and
    // message threads. We don't want to inject a comment bar there.
    document.body.innerHTML = `
      <div data-testid="ui-core-tiptap-text-editor-wrapper">
        <div class="tiptap ProseMirror"
             role="textbox"
             contenteditable="true"
             aria-label="Text editor for creating post"></div>
      </div>
      <div data-testid="some-other-wrapper">
        <div class="tiptap ProseMirror"
             role="textbox"
             contenteditable="true"
             aria-label="Write a message"></div>
      </div>
    `;

    // aria-label substring "comment" should NOT match "creating post" or "Write a message"
    expect(document.querySelectorAll('[contenteditable="true"][aria-label*="comment" i]').length).toBe(0);
    expect(document.querySelectorAll('[role="textbox"][aria-label*="comment" i]').length).toBe(0);
  });
});
