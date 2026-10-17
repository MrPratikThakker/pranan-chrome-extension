/**
 * LinkedIn comment bars only where the user is typing, and an x that sticks
 * (audit 17 Oct 2026). A bar used to sit above every comment box on the page,
 * and its x cleared the bar's marker, so the next page change put it back.
 *
 * One test per file on purpose: the LinkedIn script has no single-instance
 * guard, so a second import in the same file leaves the first copy's
 * document listeners running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

vi.mock('@/lib/observability', () => ({ bootstrapSentry: vi.fn(), captureError: vi.fn(), captureMessage: vi.fn(), addBreadcrumb: vi.fn() }));

let env: ReturnType<typeof installChromeStorage>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = `
    <div class="feed">
      <div class="post" id="p1">
        <div data-testid="ui-core-tiptap-text-editor-wrapper">
          <div contenteditable="true" aria-label="Text editor for creating comment" id="c1"></div>
        </div>
      </div>
      <div class="post" id="p2">
        <div data-testid="ui-core-tiptap-text-editor-wrapper">
          <div contenteditable="true" aria-label="Text editor for creating comment" id="c2"></div>
        </div>
      </div>
    </div>`;
  env = installChromeStorage();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    runtime: {
      id: 'ext',
      getManifest: () => ({ version: 'test' }),
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: vi.fn() },
    },
  };
  Object.defineProperty(location, 'href', { configurable: true, writable: true, value: 'https://www.linkedin.com/feed/' });
  await import('../src/content/linkedin/index');
});

afterEach(() => { vi.useRealTimers(); });

const bars = () => document.querySelectorAll<HTMLElement>('[data-pranan-li-comment-bar]');
/** Any page change; LinkedIn's feed makes these constantly. */
async function pageChanges() {
  document.querySelector('.feed')!.append(document.createElement('span'));
  await vi.advanceTimersByTimeAsync(300);
}

describe('LinkedIn comment bars', () => {
  it('appear only above the box being typed in, and stay closed after their x', async () => {
    await vi.advanceTimersByTimeAsync(300);
    await pageChanges();
    expect(bars()).toHaveLength(0);

    // Click into the first comment box: one bar, above that box only.
    document.getElementById('c1')!.focus();
    await vi.advanceTimersByTimeAsync(300);
    expect(bars()).toHaveLength(1);
    expect(document.getElementById('p1')!.querySelector('[data-pranan-li-comment-bar]')).toBeTruthy();

    // It stays when focus moves on and the page changes.
    (document.activeElement as HTMLElement).blur();
    await pageChanges();
    expect(bars()).toHaveLength(1);

    // Its x hides it and saves that.
    bars()[0].querySelector<HTMLButtonElement>('button[aria-label="Hide on LinkedIn comments"]')!.click();
    expect(bars()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.local.data['pranan.hiddenPageBars']).toEqual(['linkedinComment']);

    // The page change that used to put it straight back does not.
    await pageChanges();
    expect(bars()).toHaveLength(0);

    // Nor does clicking into another comment box.
    document.getElementById('c2')!.focus();
    await vi.advanceTimersByTimeAsync(300);
    await pageChanges();
    expect(bars()).toHaveLength(0);
  });
});
