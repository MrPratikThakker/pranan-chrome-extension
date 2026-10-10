/**
 * What "Remember this page" sends: the visible text of the page's main
 * content, nothing else. No form values, no hidden text, no page source.
 */

/** Most text sent for one page; the app reads the same amount. */
export const MAX_PAGE_TEXT = 12_000;
/** Shortest text worth sending. */
export const MIN_PAGE_TEXT = 40;

/** A sign-in or payment form is on the page: never offer to read it. */
export function looksLikeLoginPage(doc: Document = document): boolean {
  return Boolean(doc.querySelector('input[type="password"], input[autocomplete="cc-number"], input[autocomplete="one-time-code"]'));
}

const BLOCK_TAGS = 'p, div, section, article, header, footer, aside, nav, li, ul, ol, dl, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, pre, table, tr, td, th, figcaption, hr';

/** The element holding the page's main content, else the body. */
export function mainContent(doc: Document = document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('main, [role="main"], article'));
  const best = candidates
    .map((el) => ({ el, len: (el.innerText || el.textContent || '').trim().length }))
    .sort((a, b) => b.len - a.len)[0];
  return best && best.len >= MIN_PAGE_TEXT ? best.el : doc.body;
}

/** Visible text, whitespace tidied, capped at MAX_PAGE_TEXT. */
export function pageText(doc: Document = document): string {
  const root = mainContent(doc);
  if (!root) return '';
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, noscript, template, svg, canvas, input, textarea, select, [hidden], [aria-hidden="true"], #pranan-learn-host').forEach((el) => el.remove());
  // A detached copy has no layout, so innerText loses the breaks between
  // blocks ("Plan" + "We chose" became "PlanWe chose"). Mark them by hand.
  clone.querySelectorAll(BLOCK_TAGS).forEach((el) => el.after('\n'));
  clone.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  const raw = clone.textContent || '';
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PAGE_TEXT);
}
