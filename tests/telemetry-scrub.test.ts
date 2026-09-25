/**
 * Audit EXT-20: error reports must not carry personal data, and the normal
 * "no compose open" state must not escalate once a minute.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scrubEvent, stripUrl } from '../src/lib/observability';

describe('scrubEvent', () => {
  it('strips query strings and drops bodies, cookies and message text', () => {
    const event = scrubEvent({
      request: { url: 'https://app.pranan.ai/api/companion/context?email=sam%40x.com&name=Sam', method: 'GET', cookies: { a: 'b' }, headers: { Authorization: 'Bearer t' }, data: 'secret' },
      extra: { url: 'https://app.pranan.ai/api/companion/context?email=sam%40x.com', body: '{"draft":"private"}', status: 500, draft: 'hello' },
      user: { id: 'u1', email: 'sam@x.com' },
    });
    expect(event.request).toEqual({ url: 'https://app.pranan.ai/api/companion/context', method: 'GET' });
    expect(event.extra).toEqual({ url: 'https://app.pranan.ai/api/companion/context', status: 500 });
    expect(event.user).toEqual({ id: 'u1' });
  });

  it('stripUrl keeps only origin and path', () => {
    expect(stripUrl('https://mail.google.com/mail/u/0/?q=from:sam#inbox/123')).toBe('https://mail.google.com/mail/u/0/');
  });
});

vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('../src/lib/observability')>()),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('selector chain telemetry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('escalates a broken chain once per page, then keeps it as a breadcrumb', async () => {
    vi.useFakeTimers();
    const { findOne } = await import('../src/content/selectors');
    const { captureMessage } = await import('@/lib/observability');
    document.body.innerHTML = '';
    findOne('test.escalate_once', ['.missing']);
    vi.advanceTimersByTime(61_000);
    findOne('test.escalate_once', ['.missing']);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
