import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { createNoticeActionLink, readNoticeAction } from '../src/content/shared/notice-action';
import { draftErrorAction } from '../src/lib/draft-error-message';
import { stripComments } from './helpers/strip-comments';

describe('readNoticeAction', () => {
  it('accepts the upgrade action the worker sends at the draft limit', () => {
    const action = readNoticeAction(draftErrorAction({ status: 402 }));
    expect(action).toEqual({
      kind: 'upgrade',
      label: 'Upgrade plan',
      url: 'https://app.pranan.ai/settings/billing',
      message: "You have used this month's drafts on your plan. Upgrade to keep drafting.",
    });
  });

  it('rejects a link that does not point at the Pranan app', () => {
    for (const url of ['https://evil.example/settings/billing', 'https://app.pranan.ai.evil.example/', 'javascript:alert(1)', 'data:text/html,x', '', undefined]) {
      expect(readNoticeAction({ kind: 'upgrade', label: 'Upgrade plan', url, message: 'm' })).toBeNull();
    }
  });

  it('rejects unknown kinds and non-objects', () => {
    expect(readNoticeAction({ kind: 'other', url: 'https://app.pranan.ai/settings/billing' })).toBeNull();
    expect(readNoticeAction(null)).toBeNull();
    expect(readNoticeAction('https://app.pranan.ai/settings/billing')).toBeNull();
  });
});

describe('createNoticeActionLink', () => {
  const action = readNoticeAction(draftErrorAction({ status: 402 }))!;

  it('is a real link to billing that opens in a new tab', () => {
    const link = createNoticeActionLink(action);
    expect(link.tagName).toBe('A');
    expect(link.href).toBe('https://app.pranan.ai/settings/billing');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Upgrade plan');
  });

  it('keeps its click away from the page without cancelling the navigation', () => {
    const link = createNoticeActionLink(action);
    const host = document.createElement('div');
    const pageHandler = vi.fn();
    host.addEventListener('click', pageHandler);
    host.append(link);
    document.body.append(host);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    // happy-dom would try to follow the link; the default action is not under test.
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.dispatchEvent(click);
    expect(pageHandler).not.toHaveBeenCalled();
    host.remove();
  });
});

describe('Gmail shows the action as a control, not as text', () => {
  const gmail = stripComments(readFileSync('src/content/gmail/index.ts', 'utf8'));

  it('the compose popover renders the action it is sent', () => {
    const popover = gmail.slice(gmail.indexOf('function openComposePopover'));
    expect(popover).toContain('const action = readNoticeAction(message.payload.action);');
    expect(popover).toContain('finishPopover(action?.message || message.payload.message');
    expect(popover).toContain('row.append(createNoticeActionLink(action));');
  });

  it('the inline bar renders the action it is sent', () => {
    const bar = gmail.slice(gmail.indexOf('function injectPromptBarV6'), gmail.indexOf('function injectPromptBarLegacy'));
    expect(bar).toContain('const action = readNoticeAction(msg.payload.action);');
    expect(bar).toContain('row.append(createNoticeActionLink(action));');
  });
});
