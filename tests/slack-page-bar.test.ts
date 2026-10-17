/**
 * The Slack prompt bar waits for the user and its x is remembered (audit
 * 17 Oct 2026). It used to appear as soon as Slack loaded, and its x lasted
 * only until the next click into the message box.
 *
 * One test per file on purpose: the Slack script has no single-instance
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
    <div data-qa="channel_name">general</div>
    <div class="c-wysiwyg_container">
      <div data-qa="message_input"><div contenteditable="true" class="ql-editor" data-placeholder="Message"></div></div>
    </div>
    <button id="elsewhere">Elsewhere</button>`;
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
  Object.defineProperty(location, 'href', { configurable: true, writable: true, value: 'https://app.slack.com/client/T1/C123' });
  await import('../src/content/slack/index');
});

afterEach(() => { vi.useRealTimers(); });

const input = () => document.querySelector<HTMLElement>('[data-qa="message_input"] [contenteditable="true"]')!;
const bar = () => document.querySelector<HTMLElement>('[data-pranan-slack-bar]');

describe('Slack prompt bar', () => {
  it('stays away until the message box is clicked, and stays closed after its x', async () => {
    // Page load, including the staggered checks and one 3s poll: no bar.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(bar()).toBeNull();

    // Click into the message box: the bar appears.
    input().focus();
    await vi.advanceTimersByTimeAsync(600);
    expect(bar()).toBeTruthy();

    // Its x hides it and saves that.
    bar()!.querySelector<HTMLButtonElement>('button[aria-label="Hide in Slack"]')!.click();
    expect(bar()).toBeNull();
    expect(document.querySelector('[data-pranan-bar-note="slack"]')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.local.data['pranan.hiddenPageBars']).toEqual(['slack']);

    // Leave the box and come back, and wait out the 3s poll: still gone.
    document.getElementById('elsewhere')!.focus();
    await vi.advanceTimersByTimeAsync(400);
    input().focus();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(bar()).toBeNull();

    // Turned back on from the popup: the next click into the box brings it back.
    for (const fn of env.listeners) fn({ 'pranan.hiddenPageBars': { newValue: [] } }, 'local');
    document.getElementById('elsewhere')!.focus();
    await vi.advanceTimersByTimeAsync(400);
    input().focus();
    await vi.advanceTimersByTimeAsync(600);
    expect(bar()).toBeTruthy();
  });
});
