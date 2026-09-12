import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DraftPanel } from '../src/components/DraftPanel';

let host: HTMLDivElement;
let root: Root;
const insert = vi.fn((_text, done) => done?.(true));
const copy = vi.fn(async (_text: string) => {});
const draft = { draft: 'Original reply', voiceMatch: 0, confidence: 0, alternativeTones: [] };
const click = async (label: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
};
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(React.createElement(DraftPanel, { draft, isLoading: false, onInsert: insert, onRegenerate: vi.fn(), onBack: vi.fn() })); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('preview, insert and copy all preserve the edited reply', async () => {
  await click('Edit');
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'My revised reply');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Preview');
  expect(host.textContent).toContain('My revised reply');
  await click('Insert');
  expect(insert.mock.calls[0][0]).toBe('My revised reply');
  await click('Copy to clipboard');
  expect(copy).toHaveBeenCalledWith('My revised reply');
});

it('does not claim Copied when the clipboard rejects', async () => {
  copy.mockRejectedValueOnce(new Error('denied'));
  await click('Copy to clipboard');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Copy failed');
  expect(host.textContent).not.toContain('Copied');
});
