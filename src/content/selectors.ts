/**
 * Selector Registry
 *
 * Single source of truth for the CSS selectors content scripts use to find
 * Gmail / Slack / LinkedIn DOM elements.
 *
 * Each entry is an ordered chain: try the first selector, fall back to the
 * second, etc. Whenever a fallback is used (or every selector in a chain
 * fails), we report it to Sentry as a breadcrumb + message — so when one
 * of these vendors ships a UI change, we know which selector died first
 * instead of guessing from a "drafts stopped working" report.
 *
 * Two kinds of breakage we want to learn from:
 *   - selector_fallback_used  — primary selector empty, fallback hit
 *   - selector_chain_broken   — every selector in the chain returned nothing
 *
 * The hot paths in gmail/slack/linkedin content scripts should call
 * findOne()/findAll() instead of querySelector / querySelectorAll directly.
 */

import { addBreadcrumb, captureMessage } from './observability';

export type SelectorChain = readonly string[];

// Throttle Sentry traffic: don't fire the same breakage twice within 60s.
const recentlyReported = new Map<string, number>();
const THROTTLE_MS = 60_000;

function shouldReport(key: string): boolean {
  const now = Date.now();
  const last = recentlyReported.get(key) || 0;
  if (now - last < THROTTLE_MS) return false;
  recentlyReported.set(key, now);
  // Cap memory: keep map under 200 entries.
  if (recentlyReported.size > 200) {
    const oldest = [...recentlyReported.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) recentlyReported.delete(oldest[0]);
  }
  return true;
}

function report(kind: 'fallback_used' | 'chain_broken', name: string, detail: Record<string, unknown>) {
  const key = `${kind}:${name}`;
  if (!shouldReport(key)) return;

  addBreadcrumb(`selector_${kind}: ${name}`, detail);

  // Only escalate chain_broken to a captureMessage. Fallback_used is
  // useful telemetry but not yet broken — we don't want the inbox flooded
  // every time a primary selector is slow to land.
  if (kind === 'chain_broken') {
    captureMessage(`selector_chain_broken: ${name}`, {
      component: 'content-script',
      metadata: detail,
    });
  }
}

/**
 * Find the first element matching any selector in the chain. Reports to
 * Sentry when a fallback is needed or when the entire chain fails.
 *
 * @param name     Friendly name (e.g. "gmail.composeBody"). Used as the
 *                 telemetry key so we can group reports by chain.
 * @param chain    Ordered selectors. First match wins.
 * @param root     Optional root to scope under. Defaults to document.
 */
export function findOne<T extends Element = Element>(
  name: string,
  chain: SelectorChain,
  root: ParentNode = document,
): T | null {
  for (let i = 0; i < chain.length; i++) {
    const sel = chain[i];
    let el: T | null = null;
    try {
      el = root.querySelector<T>(sel);
    } catch {
      // Invalid selector — skip and try the next.
      continue;
    }
    if (el) {
      if (i > 0) report('fallback_used', name, { matched_index: i, primary: chain[0], fallback: sel });
      return el;
    }
  }
  report('chain_broken', name, { chain });
  return null;
}

/**
 * Find all elements matching the FIRST chain entry that has any matches.
 * If the primary returns nothing, falls back to subsequent entries the
 * same way findOne does.
 */
export function findAll<T extends Element = Element>(
  name: string,
  chain: SelectorChain,
  root: ParentNode = document,
): T[] {
  for (let i = 0; i < chain.length; i++) {
    const sel = chain[i];
    let nodeList: NodeListOf<T> | null = null;
    try {
      nodeList = root.querySelectorAll<T>(sel);
    } catch {
      continue;
    }
    if (nodeList && nodeList.length > 0) {
      if (i > 0) report('fallback_used', name, { matched_index: i, primary: chain[0], fallback: sel, count: nodeList.length });
      return Array.from(nodeList);
    }
  }
  report('chain_broken', name, { chain });
  return [];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SELECTORS = {
  gmail: {
    /** Compose body (contentEditable). Most fragile chain — Gmail's class names
     *  rotate; the aria-label fallback survives nearly every UI change. */
    composeBody: [
      '.Am.aiL [contenteditable="true"]',
      '[contenteditable="true"][aria-label="Message Body"]',
      '[contenteditable="true"][g_editable="true"]',
    ],
    /** Compose container — wraps the whole pop-up window. */
    composeWindow: [
      '.AD',
      '.M9',
      '.nH.oy8Mbf',
      '[role="dialog"]',
      '.ip.iq',
    ],
    /** Recipient chips (To/Cc fields). data-hovercard-id is the canonical
     *  email source; HubSpot Sidekick strips it which is why this chain
     *  has tooltip + title fallbacks. */
    recipientChips: [
      '[data-hovercard-id]',
      '[email]',
      '.aoD [data-tooltip]',
      '.GS [data-tooltip]',
      '.afV [data-tooltip]',
    ],
    /** The To-field input itself, for value parsing fallback. */
    toFieldInput: [
      'input[aria-label*="To"]',
      'input[aria-label*="recipients"]',
      'input[name="to"]',
    ],
    /** Send button. */
    sendButton: [
      '.T-I.J-J5-Ji[data-tooltip*="Send"]',
      '[role="button"][data-tooltip-shortcut*="Send"]',
      'div[role="button"][aria-label*="Send"]',
    ],
    /** Thread view container. */
    threadView: [
      '.h7',
      '.nH.if',
    ],
  },

  slack: {
    /** Quill-like message input. */
    messageInput: [
      '.ql-editor[contenteditable="true"]',
      '[data-qa="message_input"] [contenteditable="true"]',
      '[data-qa="texty_composer_container"] [contenteditable="true"]',
    ],
  },

  linkedin: {
    /** Direct message compose body. */
    messageCompose: [
      '.msg-form__contenteditable',
      '[contenteditable="true"][role="textbox"][data-placeholder*="message"]',
    ],
    /** Comment compose on a feed post. */
    commentCompose: [
      '.comments-comment-texteditor [contenteditable="true"]',
      '.comments-comment-box__form [contenteditable="true"]',
      '[data-placeholder*="Add a comment"]',
      '.comments-comment-box [role="textbox"]',
    ],
    /** Feed post container — used to scope the post-content extraction. */
    feedPost: [
      '.feed-shared-update-v2',
      'article[data-id]',
      'div[data-urn^="urn:li:activity"]',
    ],
  },
} as const;
