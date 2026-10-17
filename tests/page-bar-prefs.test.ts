/**
 * The x on a Pranan prompt bar is remembered (audit 17 Oct 2026). These cover
 * the saved list itself; the per-site tests cover each bar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

let env: ReturnType<typeof installChromeStorage>;

beforeEach(() => {
  vi.useFakeTimers();
  env = installChromeStorage();
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: env.storage, runtime: { id: 'ext' } };
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('hidden page bars', () => {
  it('start with nothing hidden and keep only known bar names', async () => {
    const { getHiddenPageBars, normalizeHiddenPageBars } = await import('../src/lib/page-bar-prefs');
    await expect(getHiddenPageBars()).resolves.toEqual([]);
    expect(normalizeHiddenPageBars(['slack', 'slack', 'nonsense', 3, 'gmailThread'])).toEqual(['gmailThread', 'slack']);
    expect(normalizeHiddenPageBars('slack')).toEqual([]);
  });

  it('hide and show one bar without touching the others', async () => {
    const { hidePageBar, setPageBarShown, getHiddenPageBars, HIDDEN_PAGE_BARS_KEY } = await import('../src/lib/page-bar-prefs');
    await hidePageBar('slack');
    await hidePageBar('linkedinComment');
    await hidePageBar('slack');
    expect(env.local.data[HIDDEN_PAGE_BARS_KEY]).toEqual(['slack', 'linkedinComment']);
    await setPageBarShown('slack', true);
    await expect(getHiddenPageBars()).resolves.toEqual(['linkedinComment']);
  });

  it('every bar has popup wording and a note', async () => {
    const { PAGE_BARS, PAGE_BAR_LABELS, PAGE_BAR_HIDDEN_NOTE } = await import('../src/lib/page-bar-prefs');
    for (const bar of PAGE_BARS) {
      expect(PAGE_BAR_LABELS[bar].label).toBeTruthy();
      expect(PAGE_BAR_HIDDEN_NOTE[bar]).toContain('Pranan popup');
      // House copy rules.
      expect(PAGE_BAR_HIDDEN_NOTE[bar]).not.toMatch(/—/);
    }
  });
});

describe('watching hidden bars from a content script', () => {
  it('reads the saved list, then follows changes and reports them', async () => {
    env.local.data['pranan.hiddenPageBars'] = ['gmailThread'];
    const { watchHiddenPageBars } = await import('../src/lib/page-bar-prefs');
    const seen: string[][] = [];
    const watch = watchHiddenPageBars((hidden) => seen.push([...hidden]));
    expect(watch.isHidden('gmailThread')).toBe(false);
    await watch.ready;
    expect(watch.isHidden('gmailThread')).toBe(true);

    for (const fn of env.listeners) fn({ 'pranan.hiddenPageBars': { newValue: ['slack'] } }, 'local');
    expect(watch.isHidden('gmailThread')).toBe(false);
    expect(watch.isHidden('slack')).toBe(true);
    expect(seen).toEqual([['slack']]);

    // Other keys and other areas are ignored.
    for (const fn of env.listeners) fn({ other: { newValue: 1 } }, 'local');
    for (const fn of env.listeners) fn({ 'pranan.hiddenPageBars': { newValue: [] } }, 'session');
    expect(seen).toHaveLength(1);
  });

  it('dismissing saves the bar, swaps it for a note, and the note fades', async () => {
    const { watchHiddenPageBars, dismissPageBar, getHiddenPageBars } = await import('../src/lib/page-bar-prefs');
    const watch = watchHiddenPageBars();
    await watch.ready;
    const bar = document.createElement('div');
    bar.id = 'bar';
    document.body.append(bar);

    dismissPageBar('slack', bar, watch);
    expect(watch.isHidden('slack')).toBe(true);
    expect(document.getElementById('bar')).toBeNull();
    const note = document.querySelector('[data-pranan-bar-note="slack"]');
    expect(note?.textContent).toBe('Hidden in Slack. Turn it back on in the Pranan popup.');
    expect(note?.getAttribute('role')).toBe('status');
    await vi.advanceTimersByTimeAsync(0);
    await expect(getHiddenPageBars()).resolves.toEqual(['slack']);

    await vi.advanceTimersByTimeAsync(6000);
    expect(document.querySelector('[data-pranan-bar-note]')).toBeNull();
  });
});
