import { it, expect } from 'vitest';
import { findGmailPreservedBlock, injectMultilineTextBefore } from '../src/lib/safe-dom';
it('preserves signature images, links and quoted history across regeneration', () => {
  const body = document.createElement('div');
  body.innerHTML = '<div>Old reply</div><div><div class="gmail_signature"><img src="cid:logo"><a href="https://example.com">Name</a></div></div><div class="gmail_quote">Earlier message</div>';
  const signature = body.querySelector('.gmail_signature');
  for (const text of ['First draft', 'Edited draft']) injectMultilineTextBefore(body, text, findGmailPreservedBlock(body)!);
  expect(body.querySelector('.gmail_signature')).toBe(signature);
  expect(body.querySelector('img')?.getAttribute('src')).toBe('cid:logo');
  expect(body.querySelector('.gmail_quote')?.textContent).toBe('Earlier message');
  expect(body.textContent).toBe('Edited draftNameEarlier message');
});
