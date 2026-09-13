// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { composeThread, scopedThreadContext, replyTarget } from '../src/lib/gmail-compose-context';
const message = (sender: string, text: string) => `<div class="adn"><div class="gs"><span class="gD" email="${sender}">${sender}</span><div class="ii gt"><div class="a3s aiL">${text}</div></div></div></div>`;
beforeEach(() => { document.title = 'Inbox - owner@example.test - Gmail'; document.body.innerHTML = `<div role="main">${message('alex@example.test', 'Please confirm pricing')}<div class="reply"><div contenteditable="true"></div></div></div>`; });
it('does not borrow a visible thread for new mail', () => {
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.innerHTML = '<input name="subjectbox"><div class="new-compose"><div contenteditable="true"></div></div>'; document.body.append(dialog);
  expect(composeThread(dialog.querySelector('.new-compose')!)).toBeNull();
  expect(scopedThreadContext(dialog)).toBeNull();
  expect(replyTarget(dialog, ['other@example.test']).email).toBe('other@example.test');
});
it('labels sender outside the Gmail body wrapper', () => { expect(scopedThreadContext(document.querySelector('.reply')!)).toBe('From: alex@example.test\nPlease confirm pricing'); });
it('keeps thread context when Gmail mounts a hidden subject field in an inline reply', () => {
  document.querySelector('.reply')!.insertAdjacentHTML('afterbegin', '<input name="subjectbox" type="hidden">');
  expect(scopedThreadContext(document.querySelector('.reply')!)).toBe('From: alex@example.test\nPlease confirm pricing');
  expect(replyTarget(document.querySelector('.reply')!, ['alex@example.test'])).toEqual({ email: 'alex@example.test', name: 'alex@example.test' });
});
it('respects edited recipients instead of adding the last sender back', () => { expect(replyTarget(document.querySelector('.reply')!, ['other@example.test']).email).toBe('other@example.test'); });
it('does not greet self when following up after our own message', () => {
  document.querySelector('.reply')!.insertAdjacentHTML('beforebegin', message('owner@example.test', 'Can you confirm?'));
  expect(replyTarget(document.querySelector('.reply')!, ['owner@example.test', 'alex@example.test']).email).toBe('alex@example.test');
  expect(scopedThreadContext(document.querySelector('.reply')!)).toContain('From: you');
});
it('keeps labels when long history is bounded and excludes quoted compose text', () => {
  document.querySelector('.reply')!.insertAdjacentHTML('beforebegin', message('alex@example.test', 'x'.repeat(10000)));
  document.querySelector('[contenteditable]')!.innerHTML = '<div class="a3s aiL">private current draft</div>';
  const text = scopedThreadContext(document.querySelector('.reply')!)!;
  expect(text).toContain('From: alex@example.test'); expect(text.length).toBeLessThan(2000); expect(text).not.toContain('private current draft');
});
it('keeps independent inline thread containers isolated', () => {
  document.body.innerHTML = `<main><section>${message('a@example.test','A')}<div id="a"></div></section><section>${message('b@example.test','B')}<div id="b"></div></section></main>`;
  expect(scopedThreadContext(document.getElementById('a')!)).not.toContain('b@example.test');
});
