// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { ComposeTransactions } from '../src/lib/compose-transaction';
let editor: HTMLElement; let transactions: ComposeTransactions;
beforeEach(() => { editor = document.createElement('div'); editor.innerHTML = '<b>My draft</b><div class="gmail_signature">Signature</div>'; document.body.replaceChildren(editor); transactions = new ComposeTransactions(); });
it('accepts exactly once in the original editor and audience', () => {
  const id = transactions.start('a', editor, 'to:a');
  expect(transactions.consume(id, 'a', editor, 'to:a')).toBe(true);
  expect(transactions.consume(id, 'a', editor, 'to:a')).toBe(false);
});
it.each(['typing', 'recipient', 'editor', 'closed', 'cancelled'])('preserves draft when %s changes mid-flight', change => {
  const id = transactions.start('a', editor, 'to:a');
  if (change === 'typing') editor.innerHTML += ' More';
  if (change === 'closed') editor.remove();
  if (change === 'cancelled') transactions.cancel(id);
  expect(transactions.consume(id, change === 'editor' ? 'b' : 'a', editor, change === 'recipient' ? 'to:b' : 'to:a')).toBe(false);
});
it('restores formatting and signature, once', () => {
  const before = editor.innerHTML; editor.innerHTML = 'Generated'; transactions.remember(editor, before);
  expect(transactions.restore(editor)).toBe(true); expect(editor.innerHTML).toBe(before);
  expect(transactions.restore(editor)).toBe(false);
});
it('does not undo edits made after insertion or another editor', () => {
  transactions.remember(editor, 'Before'); editor.innerHTML += ' User edits';
  expect(transactions.restore(editor)).toBe(false);
  expect(transactions.restore(document.createElement('div'))).toBe(false);
});
