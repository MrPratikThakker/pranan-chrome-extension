/**
 * Which Pranan prompt bars the user has closed for good.
 *
 * The prompt bars Pranan puts on Gmail, Slack and LinkedIn used to come back
 * after their x: the Gmail bar under each email had no x at all, the Slack bar
 * returned on the next click into the message box, and the LinkedIn comment
 * bar was put back by the next page change (Pratik's audit, 17 Oct 2026). Now
 * the x on each bar saves that bar here, and the popup's "On pages" list turns
 * it back on. Same idea as "Hide on this site" for the Remember tab
 * (work-sites.ts).
 *
 * A preference, not a secret: chrome.storage.local, readable by content
 * scripts, not synced to other browsers.
 */

export type PageBar = 'gmailThread' | 'gmailCompose' | 'slack' | 'linkedinMessage' | 'linkedinComment';

export const PAGE_BARS: readonly PageBar[] = ['gmailThread', 'gmailCompose', 'slack', 'linkedinMessage', 'linkedinComment'];

/** Popup wording for each bar: what it is, and where. */
export const PAGE_BAR_LABELS: Readonly<Record<PageBar, { label: string; site: string }>> = {
  gmailThread: { label: 'Prompt under emails', site: 'Gmail' },
  gmailCompose: { label: 'Bar in compose', site: 'Gmail' },
  slack: { label: 'Bar under message box', site: 'Slack' },
  linkedinMessage: { label: 'Bar in messages', site: 'LinkedIn' },
  linkedinComment: { label: 'Bar above comments', site: 'LinkedIn' },
};

/** The note a bar shows when its x has just hidden it. */
export const PAGE_BAR_HIDDEN_NOTE: Readonly<Record<PageBar, string>> = {
  gmailThread: 'Hidden under emails. Turn it back on in the Pranan popup.',
  gmailCompose: 'Hidden in every email. Turn it back on in the Pranan popup.',
  slack: 'Hidden in Slack. Turn it back on in the Pranan popup.',
  linkedinMessage: 'Hidden in LinkedIn messages. Turn it back on in the Pranan popup.',
  linkedinComment: 'Hidden on LinkedIn comments. Turn it back on in the Pranan popup.',
};

export const HIDDEN_PAGE_BARS_KEY = 'pranan.hiddenPageBars';

/** Pure: keep only known bar names, once each. */
export function normalizeHiddenPageBars(raw: unknown): PageBar[] {
  if (!Array.isArray(raw)) return [];
  return PAGE_BARS.filter((bar) => raw.includes(bar));
}

export async function getHiddenPageBars(): Promise<PageBar[]> {
  try {
    const stored = await chrome.storage.local.get(HIDDEN_PAGE_BARS_KEY);
    return normalizeHiddenPageBars(stored?.[HIDDEN_PAGE_BARS_KEY]);
  } catch {
    return [];
  }
}

/** Show (true) or hide (false) one bar everywhere it appears. */
export async function setPageBarShown(bar: PageBar, shown: boolean): Promise<PageBar[]> {
  const hidden = await getHiddenPageBars();
  const next = shown ? hidden.filter((b) => b !== bar) : normalizeHiddenPageBars([...hidden, bar]);
  await chrome.storage.local.set({ [HIDDEN_PAGE_BARS_KEY]: next });
  return next;
}

export function hidePageBar(bar: PageBar): Promise<PageBar[]> {
  return setPageBarShown(bar, false);
}

/**
 * Synchronous check for content scripts. Starts as "nothing hidden" until the
 * stored list is read (`ready`), then follows changes from the popup or from
 * another tab. `onChange` runs after each change so a script can remove bars
 * that are already on the page.
 */
export function watchHiddenPageBars(onChange?: (hidden: readonly PageBar[]) => void): {
  isHidden(bar: PageBar): boolean;
  /** Record a hide straight away, before storage confirms it. */
  markHidden(bar: PageBar): void;
  ready: Promise<void>;
  stop(): void;
} {
  let hidden: PageBar[] = [];
  let stopped = false;
  const ready = getHiddenPageBars().then((stored) => {
    if (stopped) return;
    hidden = normalizeHiddenPageBars([...hidden, ...stored]);
  });
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[HIDDEN_PAGE_BARS_KEY]) return;
    hidden = normalizeHiddenPageBars(changes[HIDDEN_PAGE_BARS_KEY].newValue);
    onChange?.(hidden);
  };
  try { chrome.storage.onChanged.addListener(listener); } catch { /* storage unavailable */ }
  return {
    isHidden: (bar) => hidden.includes(bar),
    markHidden: (bar) => { if (!hidden.includes(bar)) hidden = normalizeHiddenPageBars([...hidden, bar]); },
    ready,
    stop: () => {
      stopped = true;
      try { chrome.storage.onChanged.removeListener(listener); } catch { /* pass */ }
    },
  };
}

/**
 * Close a bar for good: record it, save it, and leave a short note where the
 * bar was so the user knows how to get it back. The note fades after 6s.
 */
export function dismissPageBar(
  bar: PageBar,
  element: HTMLElement,
  prefs: { markHidden(bar: PageBar): void },
): void {
  prefs.markHidden(bar);
  void hidePageBar(bar).catch(() => {});
  const note = document.createElement('div');
  note.setAttribute('data-pranan-bar-note', bar);
  note.setAttribute('role', 'status');
  note.textContent = PAGE_BAR_HIDDEN_NOTE[bar];
  note.style.cssText = 'margin:4px 0;padding:6px 10px;font:12px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#4c1d95;background:#f5f3ff;border:1px solid #e9e5ff;border-radius:7px;max-width:560px;';
  element.replaceWith(note);
  setTimeout(() => note.remove(), 6000);
}
