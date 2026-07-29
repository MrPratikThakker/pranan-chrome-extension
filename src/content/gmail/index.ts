/**
 * Gmail Content Script
 *
 * Detects compose windows, extracts recipients, injects drafts,
 * and communicates with the service worker.
 *
 * ENHANCED (Phase 1-3):
 * - Injects "Draft with Pranan" button next to Send (Voila/Loom pattern)
 * - Shows relationship popup on compose open
 * - Monitors text for Grammarly-style suggestions
 */

// Content script -- runs in Chrome's isolated world (no ES module support)
// IIFE bundling handles scope isolation

import { injectMultilineText, findGmailQuoteBlock, injectMultilineTextBefore, normalizeDraftForPlainText } from '@/lib/safe-dom';
import { safeSendMessage } from '@/lib/runtime';
import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { stampEditor, resolveEditor } from '../shared/editor-binding';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import type { InlineSuggestion } from '../shared/inline-suggestions';
import { bootstrapSentry } from '@/lib/observability';
import { findAll, findOne, SELECTORS } from '../selectors';
import { bottomOffsetAboveSendRow, bottomOffsetForChips, correctedBottomOffset, shouldHideBar, isSendReachable, placementObscuresCompose } from '@/lib/compose-layout';
import { resolveLiveCompose, isOrphanedComposeBar } from '@/lib/live-compose';

// Smoke-test marker: lets external QA assert "Pranan content script booted
// on this page" without knowing surface-specific attribute names
// (2026-06-08 audit round 2 produced a false negative for lack of this).
try { document.documentElement.setAttribute('data-pranan-injected', chrome.runtime?.getManifest?.().version || 'true'); } catch { /* pass */ }


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


bootstrapSentry('content-gmail');

// Reference to the active inline bar's Generate trigger, so the popup's
// "Quick Draft" action (TRIGGER_INLINE_DRAFT) can fire the same flow.
let activeInlineGenerate: (() => void) | null = null;

const COMPOSE_SELECTORS = {
  // Gmail compose window container
  composeContainer: '.T-I.T-I-KE.L3',
  // Active compose window
  composeWindow: '.nH .aO7',
  // Compose body (contentEditable)
  composeBody: '.Am.aiL [contenteditable="true"], [aria-label="Message Body"]',
  // Recipient chips
  recipientChips: '.afV [data-hovercard-id], .GS .aB.gR [email]',
  // To field container
  toField: '.aoD.hl [data-hovercard-id], .GS input[aria-label="To recipients"]',
  // Subject line
  subjectLine: 'input[name="subjectbox"]',
  // Send button
  sendButton: '.T-I.J-J5-Ji[data-tooltip*="Send"]',
  // Reply area
  replyContainer: '.ip.iq',
  // Thread view
  threadView: '.h7',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeComposeObservers: Map<Element, MutationObserver> = new Map();
let lastDetectedRecipientPerCompose: Map<Element, string | null> = new Map();
let activeSuggestionCleanups: Map<Element, () => void> = new Map();
let contactContextCache: Map<string, RelationshipPopupData> = new Map();

// ---------------------------------------------------------------------------
// Compose Detection
// ---------------------------------------------------------------------------

function findComposeWindows(): Element[] {
  // Use the selector registry so a Gmail UI change reports to Sentry as
  // selector_chain_broken instead of silently returning no compose windows.
  const editables = findAll('gmail.composeBody', SELECTORS.gmail.composeBody);
  if (editables.length === 0) return [];

  // Compose container chain — same fallback shape, but here we want closest()
  // semantics, so build a comma-joined selector from the registered chain.
  const containerSelector = SELECTORS.gmail.composeWindow.join(', ');

  const containers = new Set<Element>();
  for (const el of editables) {
    const container = el.closest(containerSelector);
    if (container) {
      containers.add(container);
    } else {
      const parent = el.closest('.nH, .aoP, .aaZ') || el.parentElement?.parentElement;
      if (parent) containers.add(parent);
    }
  }

  return Array.from(containers);
}

function extractRecipients(composeWindow: Element): string[] {
  const emails: string[] = [];

  // Method 1+2 collapsed onto the recipient chip chain. The registry
  // tracks both data-hovercard-id (modern Gmail) and [email] (older Gmail)
  // plus tooltip/title fallbacks. If primary is empty and a fallback chip
  // is hit, we get a Sentry breadcrumb so we know HubSpot Sidekick (or
  // similar) is rewriting recipient chips on this user's tab.
  const chips = findAll('gmail.recipientChips', SELECTORS.gmail.recipientChips, composeWindow);
  chips.forEach(chip => {
    const email = chip.getAttribute('data-hovercard-id') || chip.getAttribute('email') || '';
    if (email && email.includes('@')) {
      emails.push(email);
    }
  });

  // Method 3: Chip spans with data-tooltip containing email
  const tooltipChips = findAll('gmail.recipientTooltipChips', SELECTORS.gmail.recipientTooltipChips, composeWindow);
  tooltipChips.forEach(el => {
    const tooltip = el.getAttribute('data-tooltip') || '';
    const emailMatch = tooltip.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) emails.push(emailMatch[0]);
  });

  // Method 4: Chip spans with title attribute containing email
  const titleChips = findAll('gmail.recipientTooltipChips', ['.aoD [title]', '.GS [title]'], composeWindow);
  titleChips.forEach(el => {
    const title = el.getAttribute('title') || '';
    const emailMatch = title.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) emails.push(emailMatch[0]);
  });

  // Method 5: Parse To input field value
  const toInputs = findAll('gmail.toFieldInputs', SELECTORS.gmail.toFieldInputs, composeWindow);
  toInputs.forEach(input => {
    const value = (input as HTMLInputElement).value;
    const match = value.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (match) emails.push(...match);
  });

  // Method 6: For reply windows, extract from the reply header
  if (emails.length === 0) {
    const replyHeader = composeWindow.closest('.h7, .gs, .nH');
    if (replyHeader) {
      const fromSpans = findAll('gmail.replyHeader', SELECTORS.gmail.replyHeader, replyHeader);
      fromSpans.forEach(el => {
        const email = el.getAttribute('email');
        if (email && email.includes('@')) emails.push(email);
      });
    }
  }

  return [...new Set(emails)];
}

/**
 * Extract a human-readable recipient name for the given email.
 * Tries multiple Gmail DOM patterns; returns null if nothing usable.
 */
function extractRecipientName(composeWindow: Element, email: string): string | null {
  if (!email) return null;
  const lowerEmail = email.toLowerCase();

  // Pattern A: chip with both data-hovercard-id (email) and a name span inside
  const chips = composeWindow.querySelectorAll('[data-hovercard-id]');
  for (const chip of Array.from(chips)) {
    if ((chip.getAttribute('data-hovercard-id') || '').toLowerCase() === lowerEmail) {
      const name = chip.getAttribute('name') || chip.getAttribute('data-name') || (chip.textContent || '').trim();
      if (name && !name.includes('@') && name.length > 1) return name.replace(/[<>]/g, '').trim();
    }
  }

  // Pattern B: tooltip "Name <email@x.com>"
  const tooltips = composeWindow.querySelectorAll('[data-tooltip], [title]');
  for (const el of Array.from(tooltips)) {
    const t = (el.getAttribute('data-tooltip') || el.getAttribute('title') || '').trim();
    const m = t.match(/^([^<]+)<([^>]+)>$/);
    if (m && m[2].toLowerCase() === lowerEmail) return m[1].trim();
  }

  // Pattern C: thread header — for Reply windows, the original sender's name
  const threadHeader = composeWindow.closest('.h7, .gs, .nH');
  if (threadHeader) {
    const fromCandidates = threadHeader.querySelectorAll('.gD, .go, [email]');
    for (const el of Array.from(fromCandidates)) {
      if ((el.getAttribute('email') || '').toLowerCase() === lowerEmail) {
        const name = el.getAttribute('name') || (el.textContent || '').trim();
        if (name && !name.includes('@') && name.length > 1) return name.replace(/[<>"]/g, '').trim();
      }
    }
  }

  return null;
}

function getComposeBody(composeWindow: Element): string {
  const body = composeWindow.querySelector(
    '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
  );
  return body?.textContent?.trim() || '';
}

function getThreadContext(composeWindow: Element): string | null {
  // Try several thread-container selectors. Gmail rotates class names, so we
  // walk up looking for any of: the legacy .h7/.gs containers, the modern
  // [role="main"] thread region, or any [data-thread-perm-id] ancestor. If
  // none match, fall back to the visible thread on the page (most recent).
  const thread =
    composeWindow.closest('.h7, .gs') ||
    composeWindow.closest('[data-thread-perm-id]') ||
    composeWindow.closest('[role="main"]') ||
    findOne('gmail.threadRoot', SELECTORS.gmail.threadRoot);

  if (!thread) return null;

  // Collect ALL visible message bodies. .a3s.aiL is the legacy selector;
  // .ii.gt is the modern message-body wrapper; [data-message-id] .a3s catches
  // newer Gmail variants. Take up to the last 3 messages so the LLM has
  // recent context plus the message being replied to.
  const messageBodies = thread.querySelectorAll(
    '.a3s.aiL, .ii.gt .a3s, [data-message-id] .a3s, .ii .a3s, [role="listitem"] .a3s'
  );
  if (messageBodies.length === 0) return null;

  const recent = Array.from(messageBodies).slice(-3);
  const combined = recent
    .map((m: Element) => (m as HTMLElement).innerText?.trim() || m.textContent?.trim() || '')
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!combined) return null;
  // Cap at 4000 chars (~1k tokens) so we don't blow the context window.
  return combined.slice(-4000);
}

function getSubject(composeWindow: Element): string | null {
  const subjectInput = composeWindow.querySelector(
    'input[name="subjectbox"]'
  ) as HTMLInputElement | null;
  return subjectInput?.value || null;
}

// ---------------------------------------------------------------------------
// Draft Injection
// ---------------------------------------------------------------------------

function injectDraft(composeWindow: Element, draftText: string): boolean {
  const body = composeWindow.querySelector(
    '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
  ) as HTMLElement | null;

  if (!body) return false;

  body.focus();
  // Preserve the Gmail quoted thread on replies so newly-added recipients still
  // get the conversation history. The old path cleared the whole body, wiping
  // the quote (QA 2026-06-12: a CC'd colleague received the reply with no
  // context). Insert the draft ABOVE the quote; fall back to full-body write
  // only for a fresh compose with no quoted thread.
  const clean = normalizeDraftForPlainText(draftText);
  const quoteBlock = findGmailQuoteBlock(body);
  if (quoteBlock) {
    injectMultilineTextBefore(body, clean, quoteBlock, 'div');
  } else {
    injectMultilineText(body, clean, 'div');
  }

  body.dispatchEvent(new Event('input', { bubbles: true }));
  body.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}

// ---------------------------------------------------------------------------
// Phase 1: Inline Button Injection
// Injects a prompt bar above the compose window (like Voila) and also a
// small floating icon inside the compose body (like Grammarly).
// ---------------------------------------------------------------------------

const PRANAN_FLOAT_ATTR = 'data-pranan-float';
const PRANAN_BAR_ATTR = 'data-pranan-bar';

/**
 * Injects the Pranan prompt bar above the compose window (Voila-style)
 * and a small icon inside the compose body (Grammarly-style).
 */
function injectComposeButtons(composeWindow: Element) {
  const recipients = extractRecipients(composeWindow);
  const recipientEmail = recipients[0] || null;

  // --- 1. Prompt bar above compose (Voila position) ---
  injectPromptBar(composeWindow, recipientEmail);

  // --- 2. Small floating icon in compose body (Grammarly position) ---
  injectFloatingIcon(composeWindow, recipientEmail);
}

/**
 * Place our bar so it never covers what the user needs.
 *
 * History, because this has now been wrong in three different ways.
 *
 * Originally the bar sat in normal flow above the compose. Gmail sizes the
 * compose window and never re-flows when a third party inserts a node, so in a
 * MAXIMISED compose the bar pushed Gmail's toolbar down and Send fell below the
 * fold -- reported by Ancil 2026-07-23 and Drishti 2026-07-27.
 *
 * v0.8.34 fixed that by taking the bar OUT of flow and pinning it above the
 * send row. Gmail's own layout became correct again. But out of flow means
 * ON TOP OF, and nothing checked what was underneath. Measured live on
 * 2026-07-29 with v0.8.34 installed, on an ordinary inline reply: the bar
 * covered the typing area by 16px AND Send by 24px at the same time. It did not
 * even fix its own bug; it just moved it and added another.
 *
 * The rule the earlier attempts were missing is simple, so it is now explicit
 * and tested (placementObscuresCompose): OUR UI MAY NEVER SIT ON TOP OF THE
 * TEXT BEING WRITTEN OR THE SEND BUTTON. Priority order:
 *
 *   1. never cover the compose
 *   2. never make Send unreachable
 *   3. show the bar
 *
 * So: stay in normal flow, which cannot overlay anything and is right for the
 * common inline reply. Only when in-flow genuinely pushes Send out of reach do
 * we pin out of flow, and if that pinned position would cover the editor or
 * Send we hide the bar instead of covering them.
 *
 * Re-runs on resize and on dialog resize (full screen, pop-out, drag), because
 * the previous attempt used one-shot timers and stopped applying the moment the
 * user changed compose state, which is why it kept coming back.
 */
/**
 * @param getCompose resolves the compose LIVE on every pass. The bar outlives
 * the compose it was built against (it is injected into the thread container,
 * so Gmail and HubSpot Sales can replace the compose subtree underneath it),
 * and a captured Element silently stops matching anything. See live-compose.ts.
 */
function positionComposeBar(bar: HTMLElement, getCompose: () => Element) {
  const host = bar.parentElement as HTMLElement | null;
  if (!host) return;

  const chipsOf = () => host.querySelector('[data-pranan-intents]') as HTMLElement | null;

  const releaseToFlow = () => {
    for (const el of [bar, chipsOf()]) {
      if (!el) continue;
      el.style.position = '';
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.margin = '';
      el.style.zIndex = '';
    }
  };

  /**
   * Show or hide, restoring the display the element was BUILT with.
   *
   * Assigning '' does not mean "default" here, it removes the inline
   * declaration entirely -- and both the bar and the chips row are constructed
   * with an inline `display: flex` in their cssText. Clearing it drops them to
   * `block`, so the icon falls onto its own line, the chips stop sitting in a
   * row, and the bar grows from 60px to 94px. Measured live on 29 Jul: forcing
   * flex back took it 94px -> 60px with every child on one row.
   */
  const setVisible = (visible: boolean) => {
    bar.style.display = visible ? 'flex' : 'none';
    const chips = chipsOf();
    if (chips) chips.style.display = visible ? 'flex' : 'none';
  };

  /**
   * Match Gmail's compose CONTENT edge while in flow.
   *
   * The bar is injected at the container's outer width, but Gmail insets the
   * compose body by the avatar gutter (~80px), so an unaligned bar hangs to the
   * left of the card beneath it -- visible as the bar jutting out past the
   * compose in the 29 Jul screenshots, measured at 81px.
   *
   * This has to live here rather than beside the injection code. releaseToFlow
   * clears `margin` to undo pinning, which also wipes the alignment margin, and
   * apply() re-runs on rAF, at 300/900/2000ms and on every mutation. So an
   * alignment applied once from outside gets erased by the next pass. Releasing
   * and aligning have to happen together, in that order, every time.
   */
  const alignInFlow = () => {
    if (bar.style.position === 'absolute') return;
    const body = getCompose().querySelector(
      '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
    ) as HTMLElement | null;
    if (!body || !document.contains(bar)) return;
    const delta = Math.round(body.getBoundingClientRect().left - bar.getBoundingClientRect().left);
    // Sanity bounds: a real gutter, not a transient layout mid-animation.
    if (delta > 4 && delta < 200) {
      const current = parseFloat(bar.style.marginLeft) || 0;
      bar.style.marginLeft = `${current + delta}px`;
      const chips = chipsOf();
      if (chips) chips.style.marginLeft = bar.style.marginLeft;
    }
  };

  const flowAndAlign = () => { releaseToFlow(); setVisible(true); alignInFlow(); };

  /**
   * Gmail keeps the `.ip.iq` reply wrapper after a send but throws the compose
   * away, so the bar is left on screen with nothing to write into. The next
   * reply gets a fresh wrapper, which injectPromptBar's dedupe guard cannot
   * see, and the bars stack up one per cycle. Measured: two bars, zero composes.
   *
   * Confirm before removing. Gmail detaches and reattaches the compose during
   * its own relayouts, and a bar that vanishes mid-render and comes back is a
   * worse bug than the one being fixed.
   */
  let orphanTimer: ReturnType<typeof setTimeout> | null = null;
  const retireIfOrphaned = (): boolean => {
    if (!isOrphanedComposeBar(bar, SELECTORS.gmail.composeBody.join(', '))) {
      if (orphanTimer) { clearTimeout(orphanTimer); orphanTimer = null; }
      return false;
    }
    if (orphanTimer) return false; // already counting down
    orphanTimer = setTimeout(() => {
      orphanTimer = null;
      if (!isOrphanedComposeBar(bar, SELECTORS.gmail.composeBody.join(', '))) return;
      chipsOf()?.remove();
      bar.remove();
    }, 1200);
    return false;
  };

  const apply = (): boolean => {
    if (!document.contains(bar)) return true; // detached: stop observing
    retireIfOrphaned();

    const sendButton = findOne<HTMLElement>('gmail.sendButton', SELECTORS.gmail.sendButton, getCompose());
    const sendRow = (sendButton?.closest('.btC')
      || sendButton?.closest('.aoP')
      || sendButton?.closest('tr')
      || sendButton?.closest('.gU')) as HTMLElement | null;

    // No send row. Either the layout is one we do not recognise, or -- far more
    // commonly -- the user discarded the reply and the compose is simply gone.
    //
    // The previous guard here said "leave the bar exactly as it was rather than
    // guess", which is right for an unknown layout and badly wrong for a closed
    // compose: it strands the bar at a bottom offset computed against a compose
    // that no longer exists, so it floats over the message body. Observed on
    // Pratik's inbox 29 Jul with the reply discarded -- no Send button anywhere
    // on the page, and the bar still position:absolute with bottom:668px.
    //
    // Releasing to flow is the safe answer in both cases: in flow the bar can
    // push layout around but can never sit on top of anything.
    if (!sendButton || !sendRow) {
      flowAndAlign();
      return false;
    }

    const editor = getCompose().querySelector('[g_editable="true"], [contenteditable="true"][role="textbox"]') as HTMLElement | null;

    // 1. In normal flow. Cannot overlay anything, and is correct for the inline
    //    reply that most people use most of the time.
    flowAndAlign();

    // An inline reply lives in the scrolling thread, so "below the fold" is not
    // "unreachable" -- you scroll to it. Measured on Pratik's own reply: Send
    // sat at y=774 in a 767px viewport, which isSendReachable calls unreachable
    // even though it is one scroll away. Applying that test here is what would
    // drag the bar back out of flow and on top of the compose again. The
    // out-of-flow trick exists solely for a compose Gmail has pinned to a fixed
    // box: the floating or maximised dialog, where nothing scrolls into view.
    const inFixedDialog = Boolean(getCompose().closest('[role="dialog"]'));
    if (!inFixedDialog) return false;

    if (isSendReachable(sendButton.getBoundingClientRect(), window.innerHeight)) return false;

    // 2. In flow has pushed Send out of reach -- a maximised or short compose.
    //    Pin above the send row so Gmail's own layout is untouched.
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    let offset = bottomOffsetAboveSendRow(host.getBoundingClientRect(), sendRow.getBoundingClientRect());
    bar.style.position = 'absolute';
    bar.style.top = '';
    bar.style.left = '12px';
    bar.style.right = '12px';
    bar.style.bottom = `${offset}px`;
    bar.style.margin = '0';
    bar.style.zIndex = '5';

    // Gmail rebuilds the compose on full-screen toggle, so the offset parent is
    // not always the host we measured from. Correct by the observed overlap.
    const corrected = correctedBottomOffset(offset, bar.getBoundingClientRect(), sendRow.getBoundingClientRect());
    if (corrected !== null) {
      offset = corrected;
      bar.style.bottom = `${offset}px`;
    }

    const chips = chipsOf();
    if (chips) {
      chips.style.position = 'absolute';
      chips.style.left = '12px';
      chips.style.right = '12px';
      chips.style.margin = '0';
      chips.style.zIndex = '5';
      chips.style.bottom = `${bottomOffsetForChips(offset, bar.getBoundingClientRect().height)}px`;
    }

    // 3. If the pinned position covers the text or the button, do not cover
    //    them. An invisible bar costs the user a feature; a bar over the Send
    //    button costs them the ability to send at all.
    if (placementObscuresCompose(
      bar.getBoundingClientRect(),
      editor?.getBoundingClientRect(),
      sendRow.getBoundingClientRect()
    )) {
      releaseToFlow();
      setVisible(false);
      return false;
    }

    // Last safety net: our UI must never be why Send is unreachable.
    setVisible(!shouldHideBar(sendButton.getBoundingClientRect(), window.innerHeight));
    return false;
  };

  apply();
  requestAnimationFrame(apply);
  [300, 900, 2000].forEach((ms) => setTimeout(apply, ms));

  window.addEventListener('resize', apply);
  const dialog = getCompose().closest('[role="dialog"]');
  if (dialog && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!document.contains(bar)) { ro.disconnect(); return; }
      apply();
    });
    ro.observe(dialog);
  }

  // Discarding a reply fires none of the triggers above: no resize, no dialog
  // resize, and the timers have long since run. Without this the bar keeps the
  // absolute position it was given for a compose that no longer exists, which
  // is exactly what was seen on 29 Jul -- reply discarded, no Send button on the
  // page, bar still pinned at bottom:668px over the message body.
  //
  // Watch the surrounding container for Gmail tearing the compose out, and
  // re-run. Coalesced through requestAnimationFrame so a burst of Gmail DOM
  // churn costs one pass, not hundreds.
  if (typeof MutationObserver !== 'undefined') {
    let queued = false;
    const mo = new MutationObserver(() => {
      if (!document.contains(bar)) { mo.disconnect(); return; }
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; apply(); });
    });
    mo.observe(host, { childList: true, subtree: true });
  }
}

function injectPromptBar(composeWindow: Element, recipientEmail: string | null) {
  // Find the compose container to insert before
  // Gmail reply compose lives inside .ip.iq (reply container)
  // New compose lives inside .AD, .M9, or dialog
  const composeContainer = composeWindow.closest('.ip.iq, .AD, .M9, [role="dialog"], .nH.oy8Mbf');
  if (!composeContainer) return;

  // Don't inject twice
  if (composeContainer.querySelector(`[${PRANAN_BAR_ATTR}]`)) return;
  // Check parent too
  if (composeContainer.parentElement?.querySelector(`[${PRANAN_BAR_ATTR}]`)) return;

  // v0.6 inline bar — default ON as of v0.7.1.
  // Opt-out: window.localStorage.setItem('PRANAN_V6_BAR', '0')
  let v6Enabled = true;
  try {
    const flag = window.localStorage.getItem('PRANAN_V6_BAR');
    if (flag === '0') v6Enabled = false;
  } catch { /* sandbox */ }

  if (v6Enabled) {
    injectPromptBarV6(composeContainer, composeWindow, recipientEmail);
  } else {
    injectPromptBarLegacy(composeContainer, composeWindow, recipientEmail);
  }
}

// ---------------------------------------------------------------------------
// v0.6 Inline composer bar — Surface A
// White background, real input + chips + Generate button, three states.
// Behind localStorage flag PRANAN_V6_BAR=1 for dogfood.
// ---------------------------------------------------------------------------
function injectPromptBarV6(composeContainer: Element, composeWindow: Element, recipientEmail: string | null) {
  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_BAR_ATTR, 'true');
  bar.setAttribute('data-pranan-v6', '1');

  /**
   * The compose, resolved fresh on every read.
   *
   * `composeWindow` above is captured once and then goes stale: the bar is
   * injected into the thread container, so it survives Gmail (and HubSpot
   * Sales) replacing the compose subtree, and every subsequent read through the
   * captured Element quietly returns nothing — no recipients, no thread
   * context, no editable to stamp. Measured live on 29 Jul: Generate ran
   * against a detached node, sent a reply request with no thread, and left the
   * editor empty for the full 30s timeout. Falls back to the captured value so
   * behaviour is unchanged when nothing has moved.
   */
  const liveCompose = (): Element =>
    resolveLiveCompose(bar, composeWindow, SELECTORS.gmail.composeBody.join(', '), SELECTORS.gmail.composeWindow.join(', '))
    || composeWindow;
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    /* Sized to its contents rather than the full compose width, so it sits as
       a tidy block above the chips row instead of a very wide, mostly empty
       panel. Still shrinks on narrow windows. */
    width: fit-content;
    max-width: 100%;
    padding: 10px 14px 10px 12px;
    margin: 10px 0 6px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  `;

  // Pranan icon — round atom mark in a small bordered tile
  const iconWrap = document.createElement('div');
  iconWrap.style.cssText = `
    width: 32px; height: 32px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    background: white;
  `;
  iconWrap.innerHTML = `<svg width="20" height="20" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="vbg-${Math.random().toString(36).slice(2,8)}" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#4c1d95"/></linearGradient></defs><circle cx="60" cy="60" r="33" stroke="#8b5cf6" stroke-width="7" fill="none"/><circle cx="60" cy="60" r="16" fill="#8b5cf6"/></svg>`;

  // Real input element (replaces the passive span)
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Draft a reply with Pranan...';
  input.style.cssText = `
    flex: 1 1 auto;
    min-width: 100px;
    /* Capped so the bar reads as a compact control group. An uncapped flex
       grow stretched the field to ~1000px on a wide compose and stranded the
       recipient chip, tone and Generate against the far right edge, with a
       field of empty white between them. */
    max-width: 460px;
    height: 36px;
    padding: 0 12px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: #1f2937;
    background: white;
    outline: none;
  `;
  input.addEventListener('focus', () => {
    input.style.borderColor = '#a78bfa';
    // v0.7.2 — refresh recipient chip on focus
    const fresh = extractRecipients(liveCompose());
    if (fresh.length > 0) {
      const labelEl = relChip.querySelector('[data-rel-text]') as HTMLElement | null;
      if (labelEl && /New email|Reply|^$/.test(labelEl.textContent || '')) {
        const name = extractRecipientName(liveCompose(), fresh[0]) || fresh[0].split('@')[0];
        labelEl.textContent = `→ ${name}`;
      }
    }
  });
  input.addEventListener('blur', () => { input.style.borderColor = '#e5e7eb'; });

  // Relationship chip (placeholder — real tier comes from contact-styles)
  const relChip = document.createElement('span');
  relChip.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 10px;
    border: 1px solid #ddd6fe;
    border-radius: 7px;
    font-size: 11px;
    color: #6d28d9;
    background: #faf5ff;
    white-space: nowrap;
    flex-shrink: 0;
  `;
  // v0.8.10 UI QA: never label a reply compose "New email". If the compose has
  // thread context it is a reply; use "Reply" until the real recipient resolves.
  const isReplyCompose = !!getThreadContext(liveCompose());
  relChip.innerHTML = `<span style="width: 5px; height: 5px; border-radius: 50%; background: currentColor;"></span><span data-rel-text>${recipientEmail ? '→ ' + escapeText(recipientEmail.split('@')[0] || 'recipient') : (isReplyCompose ? 'Reply' : 'New email')}</span>`;

  // R2: one-click tier correction. The pill is tappable; picking a tier sets a
  // manual override server-side that the auto-classifier never overwrites.
  relChip.style.cursor = 'pointer';
  relChip.title = 'Click to correct the relationship tier';
  const TIER_OPTIONS: Array<[string, string]> = [
    ['inner_circle', 'Inner circle'],
    ['team', 'Team'],
    ['client', 'Client'],
    ['prospect', 'Prospect'],
    ['vendor', 'Vendor'],
    ['network', 'Network'],
  ];
  const resolveTargetContact = (): string | null => {
    const live = extractRecipients(liveCompose());
    if (live[0]) return live[0];
    if (recipientEmail) return recipientEmail;
    const threadsForPill = findThreadViews();
    if (threadsForPill.length > 0) {
      const sender = extractThreadSender(threadsForPill[threadsForPill.length - 1]);
      if (sender.email) return sender.email;
    }
    return null;
  };
  relChip.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const existing = document.querySelector('[data-pranan-tier-menu]');
    if (existing) { existing.remove(); return; }
    const target = resolveTargetContact();
    if (!target) return;
    const menu = document.createElement('div');
    menu.setAttribute('data-pranan-tier-menu', '1');
    menu.style.cssText = 'position:absolute;z-index:99999;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 12px rgba(15,23,42,0.12);padding:4px;display:flex;flex-direction:column;min-width:140px;font-family:inherit;';
    const rect = relChip.getBoundingClientRect();
    menu.style.left = `${rect.left + window.scrollX}px`;
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    for (const [value, label] of TIER_OPTIONS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = label;
      item.style.cssText = 'text-align:left;font:500 12px/1.2 inherit;color:#1f2937;background:none;border:none;border-radius:6px;padding:7px 10px;cursor:pointer;';
      item.addEventListener('mouseenter', () => { item.style.background = '#f5f3ff'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        const labelEl = relChip.querySelector('[data-rel-text]') as HTMLElement | null;
        safeSendMessage({ type: 'SET_TIER_OVERRIDE', payload: { email: target, tier: value } })
          .then((res: { ok?: boolean } | undefined) => {
            if (labelEl) {
              const namePart = (labelEl.textContent || '').split('(')[0].replace('→', '').trim() || target.split('@')[0];
              labelEl.textContent = res?.ok ? `→ ${namePart} (${label.toLowerCase()} ✓)` : `→ ${namePart}`;
            }
          })
          .catch(() => { /* silent */ });
      });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
    const dismiss = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', dismiss); }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  });

  // Tone chip
  const toneChip = document.createElement('span');
  toneChip.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 7px;
    font-size: 11px;
    color: #475569;
    background: white;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
  `;
  toneChip.textContent = 'Tone: auto';

  // Generate button (primary)
  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.style.cssText = `
    padding: 7px 14px;
    border: 1px solid #6d28d9;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    color: white;
    background: #6d28d9;
    cursor: pointer;
    font-family: inherit;
    flex-shrink: 0;
  `;
  genBtn.textContent = 'Generate';

  // More icon (placeholder hook for ⋯ menu — wired in next PR)
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.title = 'More options';
  moreBtn.style.cssText = `
    width: 28px; height: 28px;
    background: none;
    border: none;
    color: #94a3b8;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
  `;
  moreBtn.innerHTML = '&middot;&middot;&middot;';
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    safeSendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
  });

  bar.appendChild(iconWrap);
  bar.appendChild(input);
  bar.appendChild(relChip);
  bar.appendChild(toneChip);
  bar.appendChild(genBtn);
  bar.appendChild(moreBtn);

  // Generate handler — fire INLINE_DRAFT_REQUEST. If input has text, treat it
  // as a user prompt; otherwise generate from thread context only.
  // Loading state resets when:
  //   (a) INSERT_DRAFT message arrives back (draft was generated + injected), OR
  //   (b) 30 second safety timeout fires (something went wrong upstream)
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  let skipNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  const setLoading = (loading: boolean) => {
    if (loading) {
      genBtn.disabled = true;
      genBtn.textContent = 'Generating...';
      genBtn.style.opacity = '0.6';
      input.style.background = '#f5f3ff';
      input.disabled = true;
    } else {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate';
      genBtn.style.opacity = '1';
      input.style.background = 'white';
      input.disabled = false;
    }
  };

  // Transient amber notice below the bar. Central place so no failure path
  // (skip, empty response, timeout) can leave the bar as a silent no-op.
  const showInlineNotice = (text: string) => {
    let notice = bar.parentElement?.querySelector('[data-pranan-skip-notice]') as HTMLElement | null;
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('data-pranan-skip-notice', '1');
      notice.style.cssText = 'margin:6px 0 0;padding:8px 11px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font:500 12px/1.45 inherit;max-width:560px;';
      bar.insertAdjacentElement('afterend', notice);
    }
    notice.textContent = text;
    notice.style.display = 'block';
    input.style.borderColor = '#fbbf24';
    if (skipNoticeTimer) clearTimeout(skipNoticeTimer);
    skipNoticeTimer = setTimeout(() => {
      if (notice) notice.style.display = 'none';
      input.style.borderColor = '#e5e7eb';
    }, 9000);
  };

  const triggerGenerate = () => {
    const userPrompt = input.value.trim();
    // v0.7.2 — re-extract recipient at click time. The bar is injected as
    // soon as the compose container mounts, but Gmail's recipient chip
    // often renders ~50-200ms later. If we captured recipientEmail at
    // injection time it can be null even on a reply with a real recipient,
    // which produces the "Generate fires but no draft inserts" bug.
    const liveRecipients = extractRecipients(liveCompose());
    // The reply is addressed to whoever wrote the message being replied to,
    // i.e. the newest thread message's sender -- NOT recipients[0]. In a
    // reply-all where a teammate is listed first in the To field, recipients[0]
    // is the wrong target: we would greet our own colleague (e.g. "Hi Marshall")
    // instead of the external person who actually asked (e.g. Jarrell at G2) and
    // anchor the reply on the wrong message. Prefer the thread's most recent
    // sender; fall back to the To field only when there is no thread (new email).
    const threadsForSender = findThreadViews();
    const threadSender = threadsForSender.length > 0
      ? extractThreadSender(threadsForSender[threadsForSender.length - 1])
      : { email: null as string | null, name: null as string | null };
    let liveRecipientEmail = threadSender.email || liveRecipients[0] || recipientEmail || null;
    let recipientName =
      (liveRecipientEmail ? extractRecipientName(liveCompose(), liveRecipientEmail) : null)
      || threadSender.name
      || null;
    setLoading(true);
    // Bind this generation to THIS compose's editable body so the returned
    // draft can only be inserted here even if the user switches compose/tab
    // mid-flight (audit HIGH: wrong-place insertion). Stamp the editable body
    // (preferred) or fall back to the compose window element.
    const editableBody = (liveCompose().querySelector('[contenteditable="true"][role="textbox"], [g_editable="true"], [contenteditable="true"]') as HTMLElement | null) || liveCompose();
    const editorId = stampEditor(editableBody);
    safeSendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail: liveRecipientEmail,
        recipientName,
        messageToReplyTo: getThreadContext(liveCompose()),
        channelName: null,
        subject: getSubject(liveCompose()),
        userPrompt: userPrompt || null,
        originSurface: 'inline-bar',
        composeType: getThreadContext(liveCompose()) ? 'reply' : 'new',
        editorId,
      },
    }).then((ack) => {
      // safeSendMessage RESOLVES to null when the extension cannot be reached —
      // it never rejects, so the .catch below has never once run for the case it
      // was written for. A dead worker therefore looked identical to a slow one:
      // the bar sat on "Generating..." for the full 30s and then told the user to
      // check they were signed in. Treat a missing ack as the failure it is.
      if (ack === null) {
        if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
        setLoading(false);
        showInlineNotice('Pranan lost its connection to the browser extension. Reload this tab and try again.');
      }
    }).catch((err) => {
      console.warn('[Pranan v6] sendMessage failed:', err);
      setLoading(false);
    });
    // Update chip text live in case it was stuck on "New email"
    if (liveRecipientEmail) {
      const labelEl = relChip.querySelector('[data-rel-text]') as HTMLElement | null;
      if (labelEl && /^(New email|Reply)$/.test(labelEl.textContent || '')) {
        const displayName = recipientName || liveRecipientEmail.split('@')[0] || 'recipient';
        labelEl.textContent = `→ ${displayName}`;
      }
    }
    // Safety timeout: if INSERT_DRAFT never arrives back within 30s, reset.
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      setLoading(false);
      // Nothing came back in 30s (worker never replied / network stalled).
      // Fail loudly instead of quietly resetting to "Generate".
      showInlineNotice("This took longer than expected. Check you're signed in at app.pranan.ai, then try Generate again.");
    }, 30000);
  };

  // Expose this compose bar's trigger so the popup's Quick Draft can fire it.
  activeInlineGenerate = triggerGenerate;

  // Listen for INSERT_DRAFT — the side-panel pipeline calls this after
  // generation completes. We reset our loading state.
  // v0.8.1 — also listen for DRAFT_SKIPPED so the bar doesn't hang when the
  // backend refuses to draft (cold prospect, automated sender, etc.).
  const insertDraftListener = (msg: { type?: string; payload?: { message?: string } }) => {
    if (msg?.type === 'INSERT_DRAFT' && resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
      setLoading(false);
      input.value = '';
    } else if (msg?.type === 'DRAFT_SKIPPED' && resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
      setLoading(false);
      input.value = '';
      // Surface the FULL skip reason in a transient notice directly below the
      // bar, so the user sees WHY nothing happened AND how to override (e.g.
      // "addressed to Jigar, you are only copied. Add a prompt or pick an
      // intent to draft anyway."). The old approach stuffed this into the input
      // placeholder truncated at 87 chars, which hid the actionable half and
      // made an intentional skip look like a silent no-op.
      const skipMsg = msg.payload?.message || 'Pranan stayed out of this one. Add a prompt or pick an intent to draft anyway.';
      let notice = bar.parentElement?.querySelector('[data-pranan-skip-notice]') as HTMLElement | null;
      if (!notice) {
        notice = document.createElement('div');
        notice.setAttribute('data-pranan-skip-notice', '1');
        notice.style.cssText = 'margin:6px 0 0;padding:8px 11px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font:500 12px/1.45 inherit;max-width:560px;';
        bar.insertAdjacentElement('afterend', notice);
      }
      notice.textContent = skipMsg;
      notice.style.display = 'block';
      input.style.borderColor = '#fbbf24';
      if (skipNoticeTimer) clearTimeout(skipNoticeTimer);
      skipNoticeTimer = setTimeout(() => {
        if (notice) notice.style.display = 'none';
        input.style.borderColor = '#e5e7eb';
      }, 9000);
    }
  };
  chrome.runtime.onMessage.addListener(insertDraftListener);
  // Editor-binding copy fallback (audit HIGH): if the originating compose
  // changed before the draft returned, the draft was NOT inserted. Reset the
  // loading state and offer the user a one-click Copy so the work is not lost.
  const editorChangedListener = (ev: Event) => {
    const detail = (ev as CustomEvent<{ text?: string }>).detail;
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    setLoading(false);
    let notice = bar.parentElement?.querySelector('[data-pranan-skip-notice]') as HTMLElement | null;
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('data-pranan-skip-notice', '1');
      notice.style.cssText = 'margin:6px 0 0;padding:8px 11px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font:500 12px/1.45 inherit;max-width:560px;display:flex;align-items:center;gap:10px;justify-content:space-between;';
      bar.insertAdjacentElement('afterend', notice);
    }
    notice.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = 'You moved to a different compose, so Pranan did not insert here. Copy the draft instead?';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy draft';
    copyBtn.style.cssText = 'flex:none;padding:5px 10px;background:#92400e;color:#fff;border:none;border-radius:6px;font:600 12px/1 inherit;cursor:pointer;';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = detail?.text || '';
      navigator.clipboard?.writeText(text).then(() => {
        copyBtn.textContent = 'Copied';
      }).catch(() => { copyBtn.textContent = 'Copy failed'; });
    });
    notice.appendChild(msg);
    notice.appendChild(copyBtn);
    notice.style.display = 'flex';
    if (skipNoticeTimer) clearTimeout(skipNoticeTimer);
    skipNoticeTimer = setTimeout(() => { if (notice) notice.style.display = 'none'; }, 15000);
  };
  window.addEventListener('pranan:editor-changed', editorChangedListener);
  // Clean up listener when the bar is removed from DOM (compose closed)
  const cleanupObserver = new MutationObserver(() => {
    if (!document.contains(bar)) {
      chrome.runtime.onMessage.removeListener(insertDraftListener);
      window.removeEventListener('pranan:editor-changed', editorChangedListener);
      cleanupObserver.disconnect();
      if (resetTimer) clearTimeout(resetTimer);
      if (skipNoticeTimer) clearTimeout(skipNoticeTimer);
    }
  });
  cleanupObserver.observe(document.body, { childList: true, subtree: true });

  genBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerGenerate();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerGenerate();
    } else if (e.key === 'Escape') {
      input.blur();
      input.value = '';
    }
  });

  // Async: try to upgrade the relationship chip with the real tier from the
  // background script (best-effort; falls back to the simple email-local label).
  if (recipientEmail) {
    safeSendMessage({
      type: 'GET_RELATIONSHIP_TIER',
      payload: { email: recipientEmail },
    }).then((res: { tier?: string; name?: string } | undefined) => {
      if (!res || !res.tier) return;
      const labelEl = relChip.querySelector('[data-rel-text]') as HTMLElement | null;
      if (!labelEl) return;
      const tierLabels: Record<string, string> = {
        inner_circle: 'inner circle',
        team: 'team',
        client: 'client',
        partner: 'partner',
        network: 'network',
        unknown: 'cold sender',
      };
      const niceTier = tierLabels[res.tier] || res.tier;
      const displayName = res.name || (recipientEmail.split('@')[0] || 'recipient');
      labelEl.textContent = `→ ${displayName} (${niceTier})`;
    }).catch(() => { /* silent fallback */ });
  }

  // Insert before the compose container (so it appears above it, like Voila)
  composeContainer.parentElement?.insertBefore(bar, composeContainer);
  positionComposeBar(bar, liveCompose);

  // v0.8.33: on a floating "New Message" popup (not an inline reply), the
  // injected bar adds height, and Gmail's bottom-anchored popup grows UPWARD, so
  // its own title bar (minimize / pop-out / close) can clip behind Gmail's top
  // toolbar and become unclickable (Drishti G. 2026-07-21). Defensive: only when
  // the floating compose dialog's top edge sits above a safe offset, nudge it
  // down and cap its height so the title bar stays reachable. Inline replies
  // (not position:fixed/absolute) are never touched.
  const keepComposeTitleVisible = () => {
    if (!document.contains(bar)) return;
    const dialog = liveCompose().closest('[role="dialog"]') as HTMLElement | null;
    if (!dialog) return;
    // v0.8.34: this used to early-return unless the dialog was fixed/absolute.
    // Gmail's compose dialog computes to position:static, so the guard fired
    // every time and this protection never ran for anyone. Detect a floating
    // compose the way it actually presents -- it is the dialog Gmail anchors to
    // the viewport bottom -- and leave true inline replies alone.
    const isFloating = dialog.getBoundingClientRect().bottom >= window.innerHeight - 4;
    if (!isFloating) return; // inline reply -> leave alone
    // Only rescue a compose whose title bar is genuinely off-screen. A
    // maximised compose legitimately sits high (top ~40px) and must not be
    // nudged, or we would be re-breaking the layout we just stopped breaking.
    const SAFE_TOP = 64; // clears Gmail's top toolbar
    if (dialog.getBoundingClientRect().top < 0) {
      dialog.style.top = `${SAFE_TOP}px`;
      dialog.style.maxHeight = `calc(100vh - ${SAFE_TOP + 16}px)`;
    }
  };
  requestAnimationFrame(keepComposeTitleVisible);
  setTimeout(keepComposeTitleVisible, 600);

  // v0.8.10 UI QA: align the bar (and chips) with Gmail's compose CONTENT edge.
  // The bar is injected at the container's outer width while Gmail insets the
  // compose body for the avatar gutter (~80px), so the bar visually hung left
  // of the card below it. Measure the real inset and match it.
  const alignWithCompose = () => {
    // Pinned (out-of-flow) bars are aligned by their own left/right offsets;
    // adding a margin here would shove them sideways.
    if (bar.style.position === 'absolute') return;
    const body = liveCompose().querySelector(
      '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
    ) as HTMLElement | null;
    if (!body || !document.contains(bar)) return;
    const delta = Math.round(body.getBoundingClientRect().left - bar.getBoundingClientRect().left);
    if (delta > 4 && delta < 200) {
      const current = parseFloat(bar.style.marginLeft) || 0;
      bar.style.marginLeft = `${current + delta}px`;
      const chipsEl = bar.nextElementSibling as HTMLElement | null;
      if (chipsEl?.hasAttribute('data-pranan-intents')) chipsEl.style.marginLeft = bar.style.marginLeft;
    }
  };
  requestAnimationFrame(alignWithCompose);
  setTimeout(alignWithCompose, 600);

  // v0.8.10 UI QA: the recipient pill used to sit on "New email" until the
  // user hit Generate, because Gmail mounts recipient chips a beat after the
  // compose container. Retry extraction a few times and update the pill as
  // soon as the real recipient exists.
  const refreshPill = () => {
    if (!document.contains(bar)) return;
    const fresh = extractRecipients(liveCompose());
    if (fresh.length > 0) {
      const labelEl = relChip.querySelector('[data-rel-text]') as HTMLElement | null;
      if (labelEl && /^(New email|Reply)$/.test((labelEl.textContent || '').trim())) {
        const name = extractRecipientName(liveCompose(), fresh[0]) || fresh[0].split('@')[0];
        labelEl.textContent = `→ ${name}`;
      }
    }
  };
  [500, 1500, 3000].forEach((ms) => setTimeout(refreshPill, ms));

  // One-tap reply intents (reply threads only). We surface up to 3 short,
  // in-your-voice intent chips below the bar; tapping one steers the draft.
  const threadForIntents = getThreadContext(liveCompose());
  if (threadForIntents) {
    const chipsRow = document.createElement('div');
    chipsRow.setAttribute('data-pranan-intents', '1');
    chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px 0;padding:0 2px;';
    // v0.8.10 UI QA: inherit the bar's compose-content alignment (set below).
    if (bar.style.marginLeft) chipsRow.style.marginLeft = bar.style.marginLeft;
    const liveRecipients = extractRecipients(liveCompose());
    const intentRecipient = liveRecipients[0] || recipientEmail || null;
    const intentRecipientName = intentRecipient ? extractRecipientName(liveCompose(), intentRecipient) : null;
    safeSendMessage({
      type: 'GET_REPLY_INTENTS',
      payload: {
        platform: 'gmail',
        recipientEmail: intentRecipient,
        recipientName: intentRecipientName,
        subject: getSubject(liveCompose()),
        messageToReplyTo: threadForIntents,
      },
    }).then((res: { intents?: string[] } | undefined) => {
      const intents = (res?.intents || []).slice(0, 3);
      if (!intents.length || !document.contains(bar)) return;
      for (const intent of intents) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = intent;
        chip.style.cssText = 'font:500 12px/1.1 inherit;color:#6d28d9;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:999px;padding:5px 11px;cursor:pointer;white-space:nowrap;';
        chip.addEventListener('mouseenter', () => { chip.style.background = '#ede9fe'; });
        chip.addEventListener('mouseleave', () => { chip.style.background = '#f5f3ff'; });
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          input.value = intent;
          triggerGenerate();
          chipsRow.remove();
        });
        chipsRow.appendChild(chip);
      }
      // v0.8.11: inherit the bar's compose-content alignment at INSERTION time.
      // The creation-time check ran before alignWithCompose had measured the
      // inset (chips insert after the intents API responds), so the chips row
      // missed the margin and sat 81px left of the bar.
      if (bar.style.marginLeft) chipsRow.style.marginLeft = bar.style.marginLeft;
      bar.insertAdjacentElement('afterend', chipsRow);
    }).catch(() => { /* intents are best-effort */ });
  }
}

// ---------------------------------------------------------------------------
// Legacy bar — the v0.5.x passive label. Kept default-on until v6 is dogfooded.
// ---------------------------------------------------------------------------
function injectPromptBarLegacy(composeContainer: Element, composeWindow: Element, recipientEmail: string | null) {
  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_BAR_ATTR, 'true');
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 0;
    background: linear-gradient(135deg, rgba(20,10,35,0.97), rgba(14,10,31,0.97));
    border: 1px solid rgba(167, 139, 250, 0.45); box-shadow: 0 2px 8px rgba(109,40,217,0.15);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  `;

  bar.addEventListener('mouseenter', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.7)';
    bar.style.background = 'linear-gradient(135deg, rgba(26,12,42,0.98), rgba(20,12,40,0.98))';
  });
  bar.addEventListener('mouseleave', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.45)';
    bar.style.background = 'linear-gradient(135deg, rgba(20,10,35,0.97), rgba(14,10,31,0.97))';
  });

  const icon = document.createElement('div');
  icon.style.cssText = `
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="33" stroke="#8b5cf6" stroke-width="7" fill="none"/><circle cx="60" cy="60" r="16" fill="#8b5cf6"/></svg>`;

  const text = document.createElement('span');
  text.style.cssText = `
    font-size: 13px;
    color: #a78bfa;
    opacity: 0.6;
    flex: 1;
  `;
  text.textContent = 'Draft reply with Pranan...';

  const close = document.createElement('button');
  close.style.cssText = `
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: rgba(250,250,250,0.4);
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
  `;
  close.innerHTML = '&times;';
  close.title = 'Dismiss';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    bar.remove();
  });

  bar.appendChild(icon);
  bar.appendChild(text);
  bar.appendChild(close);

  bar.addEventListener('click', () => {
    const recipientName = recipientEmail ? extractRecipientName(composeWindow, recipientEmail) : null;
    safeSendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail,
        recipientName,
        messageToReplyTo: getThreadContext(composeWindow),
        channelName: null,
        subject: getSubject(composeWindow),
      },
    }).catch((err) => console.warn('[Pranan] sendMessage failed:', err));
  });

  composeContainer.parentElement?.insertBefore(bar, composeContainer);
  positionComposeBar(
    bar,
    () => resolveLiveCompose(bar, composeWindow, SELECTORS.gmail.composeBody.join(', '), SELECTORS.gmail.composeWindow.join(', ')) || composeWindow,
  );
}
function injectFloatingIcon(composeWindow: Element, recipientEmail: string | null) {
  // Find Gmail's send toolbar (.btC) — the bottom row with Send + Aa + emoji + attach.
  // Place the Pranan icon RIGHT AFTER the Send button, where Voila / Loom inject.
  const sendButton = findOne<HTMLElement>('gmail.sendButton', SELECTORS.gmail.sendButton, composeWindow);
  const toolbar = sendButton?.closest('.btC, .aoP, .gU') as HTMLElement | null;
  if (!sendButton || !toolbar) {
    console.log('[Pranan] send toolbar not found; falling back to compose body');
    // Fallback: floating in compose body
    const composeBody = composeWindow.querySelector(
      '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
    ) as HTMLElement | null;
    if (!composeBody) return;
    const bodyContainer = composeBody.closest('.aO7, .Am, .aoP, .M9') || composeBody.parentElement;
    if (!bodyContainer) return;
    if (bodyContainer.querySelector(`[${PRANAN_FLOAT_ATTR}]`)) return;
    const containerEl = bodyContainer as HTMLElement;
    if (window.getComputedStyle(containerEl).position === 'static') containerEl.style.position = 'relative';
    const fallbackHost = document.createElement('div');
    fallbackHost.setAttribute(PRANAN_FLOAT_ATTR, 'true');
    fallbackHost.style.cssText = `position:absolute;bottom:6px;right:52px;z-index:999`;
    mountPrananToolbarButton(fallbackHost, composeWindow, recipientEmail);
    containerEl.appendChild(fallbackHost);
    return;
  }

  // Dedup
  if (toolbar.querySelector(`[${PRANAN_FLOAT_ATTR}]`)) return;

  const host = document.createElement('div');
  host.setAttribute(PRANAN_FLOAT_ATTR, 'true');
  // height matches Gmail's own toolbar buttons (36px). Without it the host
  // shrink-wrapped the 28px button and `vertical-align: middle` aligned it to
  // the text baseline's middle rather than the row's centre, so it rode a few
  // pixels above Aa, the paperclip and everything else -- reads as "tilted up".
  host.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 36px;
    margin-left: 8px;
    vertical-align: middle;
  `;
  mountPrananToolbarButton(host, composeWindow, recipientEmail);
  // Place Pranan AFTER all existing toolbar buttons so it lands to the right
  // of Loom and Voila (which both inject after Send). Falls back to "after
  // Send" if the toolbar parent can't be resolved.
  // The row, not the Send group.
  //
  // This used to append to sendButton.parentElement, which is Gmail's `.dC`
  // wrapper around Send + its dropdown arrow -- not the toolbar. Measured live:
  // Send group spans x=405..542 and our icon landed at x=518..542, i.e. inside
  // it. Gmail styles that group as one control, so our button inherited the
  // blue pill and read as a stray dot welded onto Send, instead of sitting with
  // Aa / pencil / paperclip like Loom and Voila do.
  //
  // `toolbar` is the .btC row and was already resolved above; it just was not
  // being used for placement.
  const toolbarParent: HTMLElement | null = toolbar;
  if (toolbarParent) {
    toolbarParent.appendChild(host);
  }
  return;
}

function mountPrananToolbarButton(host: HTMLElement, composeWindow: Element, recipientEmail: string | null) {

  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      /* Sized and weighted to sit as an equal beside Gmail's own toolbar
         icons (Aa, attach, link) and the other extensions' buttons. It was
         24px with a 14px glyph at 45% opacity, which read as small and washed
         out next to them -- a faint mark rather than a control. */
      .pranan-icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .pranan-icon-btn:hover {
        background: rgba(109, 40, 217, 0.10);
      }
      .pranan-icon-btn:focus-visible {
        outline: 2px solid #6d28d9;
        outline-offset: 2px;
      }
      .pranan-icon-btn svg {
        width: 20px;
        height: 20px;
      }
      /* #a78bfa is the accent for Pranan's own dark UI. On Gmail's white
         toolbar it is far too pale, so use the deep accent -- which is exactly
         what the app's own light theme does. Flip back on a dark Gmail. */
      .pranan-icon-btn .mark { stroke: #6d28d9; }
      .pranan-icon-btn .core { fill: #6d28d9; }
      @media (prefers-color-scheme: dark) {
        .pranan-icon-btn .mark { stroke: #a78bfa; }
        .pranan-icon-btn .core { fill: #a78bfa; }
        .pranan-icon-btn:hover { background: rgba(167, 139, 250, 0.16); }
      }
    </style>
    <button class="pranan-icon-btn" title="Draft with Pranan" aria-label="Draft with Pranan">
      <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle class="mark" cx="60" cy="60" r="33" stroke-width="9" fill="none"/>
          <circle class="core" cx="60" cy="60" r="17"/>
        </svg>
    </button>
  `;

  shadow.querySelector('.pranan-icon-btn')!.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    let v6 = true;
    try {
      const flag = window.localStorage.getItem('PRANAN_V6_BAR');
      if (flag === '0') v6 = false;
    } catch { /* sandbox */ }
    if (v6) {
      openComposePopover(host, composeWindow);
      return;
    }
    const recipientName = recipientEmail ? extractRecipientName(composeWindow, recipientEmail) : null;
    safeSendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail,
        recipientName,
        messageToReplyTo: getThreadContext(composeWindow),
        channelName: null,
        subject: getSubject(composeWindow),
      },
    }).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// v0.7 Surface B: Compose-toolbar pop-over with proactive suggestions
// ---------------------------------------------------------------------------

const POPOVER_ID = 'pranan-compose-popover';

function openComposePopover(anchorHost: HTMLElement, capturedCompose?: Element) {
  // The popover is opened from the bar, so it inherits the bar's captured
  // compose reference and inherits its staleness with it. Re-resolve from the
  // popover's own anchor for the same reason the bar does. See live-compose.ts.
  const composeWindow = resolveLiveCompose(
    anchorHost,
    capturedCompose,
    SELECTORS.gmail.composeBody.join(', '),
    SELECTORS.gmail.composeWindow.join(', '),
  ) || capturedCompose;

  // Toggle if already open
  const existing = document.getElementById(POPOVER_ID);
  if (existing) {
    existing.remove();
    return;
  }

  // Build pop-over container
  const popover = document.createElement('div');
  popover.id = POPOVER_ID;
  popover.style.cssText = `
    position: fixed;
    z-index: 2147483646;
    width: 540px;
    max-height: 80vh;
    background: #ffffff;
    border-radius: 14px;
    box-shadow: 0 24px 60px -20px rgba(0,0,0,0.4);
    border: 1px solid #e5e7eb;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    overflow: hidden;
    color: #1f2937;
    display: flex;
    flex-direction: column;
  `;
  // Position above the anchor button
  const rect = anchorHost.getBoundingClientRect();
  const top = Math.max(8, rect.top - 520);
  const left = Math.max(8, Math.min(window.innerWidth - 560, rect.left - 240));
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;

  popover.innerHTML = `
    <div style="padding: 18px 22px 12px 22px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; gap: 12px;">
      <svg viewBox="0 0 120 120" width="22" height="22" fill="none">
        <circle cx="60" cy="60" r="33" stroke="#8b5cf6" stroke-width="7" fill="none"/>
        <circle cx="60" cy="60" r="16" fill="#8b5cf6"/>
      </svg>
      <div style="flex:1;">
        <div style="font-family: 'Poppins', Inter, sans-serif; font-weight: 500; font-size: 16px; color: #0f172a; letter-spacing: -0.015em;">Draft with Pranan</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 2px;" data-pranan-subtitle>Loading suggestions...</div>
      </div>
      <button data-pranan-close aria-label="Close" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; line-height: 1;">&times;</button>
    </div>
    <div data-pranan-suggestions style="padding: 8px 12px; overflow-y: auto; max-height: 320px;">
      <div style="padding: 36px 16px; text-align: center; color: #94a3b8; font-size: 13px;">Pulling your inbox signals...</div>
    </div>
    <div style="padding: 8px 24px; color: #94a3b8; font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; display: flex; align-items: center; gap: 12px;">
      <span style="flex:1; height: 1px; background: #f1f5f9;"></span>
      or write something new
      <span style="flex:1; height: 1px; background: #f1f5f9;"></span>
    </div>
    <div style="padding: 4px 24px 14px 24px;">
      <textarea data-pranan-prompt placeholder='Draft a new email. e.g. "Intro Marshall to Wajee about Singapore"' style="width: 100%; min-height: 64px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 13px; color: #1f2937; background: white; font-family: inherit; resize: vertical; outline: none;"></textarea>
    </div>
    <div style="padding: 10px 24px; border-top: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid #ddd6fe; border-radius: 7px; font-size: 11px; color: #6d28d9; background: #faf5ff;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background: currentColor;"></span>
          Writing as you
        </span>
        <span style="display: inline-flex; align-items: center; padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 7px; font-size: 11px; color: #475569; background: white;">Tone: warm</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; color: #94a3b8; font-size: 11px;">
        <span>Press</span>
        <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 1px 5px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 3px; color: #64748b;">&#8984;&#9166;</span>
        <span>to generate</span>
      </div>
    </div>
    <div style="padding: 9px 22px; background: #faf5ff; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #6d28d9;">
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" stroke="#6d28d9" stroke-width="2"/></svg>
        Private workspace &middot; Anthropic
      </span>
      <a href="https://app.pranan.ai/settings" target="_blank" style="color: #6d28d9; text-decoration: none;">Settings</a>
    </div>
  `;

  document.body.appendChild(popover);

  // Wire close
  popover.querySelector('[data-pranan-close]')!.addEventListener('click', () => popover.remove());
  // Close on outside click
  const outsideClick = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && !anchorHost.contains(e.target as Node)) {
      popover.remove();
      document.removeEventListener('mousedown', outsideClick);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', outsideClick), 50);
  // Close on Escape
  const escListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { popover.remove(); document.removeEventListener('keydown', escListener); }
  };
  document.addEventListener('keydown', escListener);

  // Freeform prompt: ⌘⏎ generates
  const promptEl = popover.querySelector('[data-pranan-prompt]') as HTMLTextAreaElement;
  promptEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      const liveRecipients = composeWindow ? extractRecipients(composeWindow) : [];
      const recipientEmail = liveRecipients[0] || null;
      const recipientName = composeWindow && recipientEmail ? extractRecipientName(composeWindow, recipientEmail) : null;
      const messageToReplyTo = composeWindow ? getThreadContext(composeWindow) : null;
      const editableBody = composeWindow
        ? ((composeWindow.querySelector('[contenteditable="true"][role="textbox"], [g_editable="true"], [contenteditable="true"]') as HTMLElement | null) || composeWindow)
        : null;
      const editorId = stampEditor(editableBody);
      safeSendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'gmail',
          recipientEmail,
          recipientName,
          messageToReplyTo,
          channelName: null,
          subject: composeWindow ? getSubject(composeWindow) : null,
          userPrompt: text,
          originSurface: 'inline-bar',
          composeType: messageToReplyTo ? 'reply' : 'new',
          editorId,
        },
      }).catch(() => {});
      popover.remove();
    }
  });

  // Fetch suggestions
  safeSendMessage({ type: 'GET_PROACTIVE_SUGGESTIONS' })
    .then((res: { suggestions?: Array<Record<string, string>>; error?: string }) => {
      const sugList = popover.querySelector('[data-pranan-suggestions]') as HTMLElement;
      const subtitle = popover.querySelector('[data-pranan-subtitle]') as HTMLElement;
      if (!sugList) return;
      const suggestions = res?.suggestions || [];
      if (suggestions.length === 0) {
        subtitle.textContent = 'Inbox under control';
        sugList.innerHTML = `
          <div style="padding: 32px 16px; text-align: center;">
            <div style="width: 48px; height: 48px; margin: 0 auto 12px auto; border-radius: 12px; background: #f5f3ff; display: flex; align-items: center; justify-content: center;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#6d28d9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div style="font-size: 15px; font-weight: 600; color: #1f2937; margin-bottom: 4px;">Inbox under control.</div>
            <div style="font-size: 12px; color: #64748b;">No follow-ups overdue. Write something new below.</div>
          </div>
        `;
        return;
      }
      subtitle.textContent = `${suggestions.length} email${suggestions.length === 1 ? '' : 's'} you were going to write`;
      sugList.innerHTML = suggestions.map((s, i) => `
        <div data-pranan-sug-idx="${i}" data-pranan-thread="${escapeAttr(s.thread_id)}" style="padding: 12px 14px; border-radius: 8px; margin-bottom: 4px; cursor: pointer; display: flex; align-items: flex-start; gap: 12px; border: 1px solid transparent;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #f5f3ff; color: #6d28d9; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0;">${escapeText((s.sender_name || s.sender_email || 'S').charAt(0).toUpperCase())}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; color: #0f172a; font-weight: 500; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeText(s.subject || '(no subject)')}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <span>${escapeText(s.received_ago || '')}</span>
              <span style="width: 3px; height: 3px; border-radius: 50%; background: currentColor;"></span>
              <span style="color: #6d28d9;">${escapeText('→ ' + (s.sender_name || s.sender_email || '') + ' (' + (s.tier || 'unknown') + ')')}</span>
              <span style="width: 3px; height: 3px; border-radius: 50%; background: currentColor;"></span>
              <span>Tone: ${escapeText(s.suggested_tone || 'warm')}</span>
            </div>
          </div>
        </div>
      `).join('');
      // Wire click handlers
      sugList.querySelectorAll<HTMLElement>('[data-pranan-sug-idx]').forEach((row) => {
        row.addEventListener('mouseenter', () => { row.style.background = '#faf5ff'; row.style.borderColor = '#ddd6fe'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; row.style.borderColor = 'transparent'; });
        row.addEventListener('click', () => {
          const threadId = row.getAttribute('data-pranan-thread');
          if (threadId) {
            safeSendMessage({ type: 'OPEN_THREAD', payload: { threadId } }).catch(() => {});
            popover.remove();
          }
        });
      });
    })
    .catch((err) => {
      const sugList = popover.querySelector('[data-pranan-suggestions]') as HTMLElement;
      const subtitle = popover.querySelector('[data-pranan-subtitle]') as HTMLElement;
      if (subtitle) subtitle.textContent = 'Could not load suggestions';
      if (sugList) sugList.innerHTML = `<div style="padding: 20px; color: #b91c1c; font-size: 13px;">${escapeText(String(err))}</div>`;
    });
}

function escapeText(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
function escapeAttr(s: string): string {
  return escapeText(s);
}

// ---------------------------------------------------------------------------
// Phase 2: Relationship Popup
// ---------------------------------------------------------------------------

function showComposeRelationshipPopup(composeWindow: Element, recipientEmail: string) {
  // Check cache first
  const cached = contactContextCache.get(recipientEmail);
  if (cached) {
    renderRelationshipPopup(composeWindow, cached);
    return;
  }

  // Request context from background
  safeSendMessage({
    type: 'REQUEST_CONTACT_POPUP',
    payload: { email: recipientEmail },
  }).then((response: unknown) => {
    const data = response as RelationshipPopupData | null;
    if (data && data.contactName) {
      contactContextCache.set(recipientEmail, data);
      renderRelationshipPopup(composeWindow, data);
    }
  }).catch(() => {});
}

function renderRelationshipPopup(composeWindow: Element, data: RelationshipPopupData) {
  // Find the To field as anchor
  const toField = findOne('gmail.toFieldContainer', SELECTORS.gmail.toFieldContainer, composeWindow);
  if (!toField) return;

  showRelationshipPopup(
    toField,
    data,
    () => {
      // Draft click -- trigger draft generation
      safeSendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'gmail',
          recipientEmail: data.contactEmail,
          recipientName: data.contactName,
          messageToReplyTo: getThreadContext(composeWindow),
          channelName: null,
        },
      }).catch(() => {});
      dismissRelationshipPopup();
    },
    () => {
      // View full -- open side panel
      safeSendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
      dismissRelationshipPopup();
    }
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Grammarly-Style Monitoring
// ---------------------------------------------------------------------------

function attachSuggestionMonitor(composeWindow: Element) {
  const body = composeWindow.querySelector(
    '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
  ) as HTMLElement | null;

  if (!body || activeSuggestionCleanups.has(composeWindow)) return;

  const cleanup = createSuggestionMonitor({
    element: body,
    onCheckRequested: async (text) => {
      try {
        const response = await safeSendMessage({
          type: 'INLINE_GRAMMAR_CHECK',
          payload: {
            text,
            platform: 'gmail',
            recipientEmail: lastDetectedRecipientPerCompose.get(composeWindow) ?? null,
          },
        });
        const result = response as { suggestions?: InlineSuggestion[] } | undefined;
        return result?.suggestions || [];
      } catch {
        return [];
      }
    },
    minLength: 40,
    debounceMs: 3000,
  });

  activeSuggestionCleanups.set(composeWindow, cleanup);
}

// ---------------------------------------------------------------------------
// Phase: Thread View Prompt Bar (Voila-style)
// Injects a "Draft with Pranan" prompt between the email body and
// Reply/Forward buttons when viewing a thread (not composing).
// ---------------------------------------------------------------------------

const PRANAN_THREAD_BAR_ATTR = 'data-pranan-thread-bar';

function isVisibleInjectionTarget(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function extractThreadSender(threadContainer: Element): { email: string | null; name: string | null } {
  // Get the last (most recent) message in the thread
  const messages = threadContainer.querySelectorAll('.gs');
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : threadContainer;

  // Extract sender email
  // In Gmail, .gD itself carries the [email] attr (not a child), e.g. <span class="gD" email="user@example.com">
  const senderEl = findOne('gmail.threadSender', SELECTORS.gmail.threadSender, lastMessage);
  const email = senderEl?.getAttribute('email') || senderEl?.getAttribute('data-hovercard-id') || null;

  // Extract sender name
  const nameEl = findOne('gmail.threadFromCandidates', SELECTORS.gmail.threadFromCandidates, lastMessage);
  const name = nameEl?.getAttribute('name') || nameEl?.textContent?.trim() || null;

  return { email, name };
}

function extractThreadSubject(threadContainer: Element): string | null {
  const subjectEl = findOne('gmail.threadSubject', SELECTORS.gmail.threadSubject, threadContainer);
  return subjectEl?.textContent?.trim() || null;
}

function extractLatestMessageText(threadContainer: Element): string | null {
  const messages = threadContainer.querySelectorAll('.a3s.aiL');
  if (messages.length === 0) return null;
  const lastMessage = messages[messages.length - 1];
  const text = lastMessage?.textContent?.trim();
  return text ? text.slice(0, 2000) : null;
}

function injectThreadPromptBar(threadContainer: Element) {
  // Don't inject twice
  if (threadContainer.querySelector(`[${PRANAN_THREAD_BAR_ATTR}]`)) return;
  if (!isVisibleInjectionTarget(threadContainer)) return;

  // Find the reply/forward button area at the bottom of the thread
  // Gmail uses .amn for the "Reply" / "Reply all" / "Forward" buttons row
  const replyButtonsRow = findOne('gmail.threadReplyButtons', SELECTORS.gmail.threadReplyButtons, threadContainer);
  if (!replyButtonsRow) return;
  if (!isVisibleInjectionTarget(replyButtonsRow)) return;

  const { email: senderEmail, name: senderName } = extractThreadSender(threadContainer);
  const subject = extractThreadSubject(threadContainer);
  const messageText = extractLatestMessageText(threadContainer);

  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_THREAD_BAR_ATTR, 'true');
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    margin: 8px 0 4px 0;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    border-radius: 8px;
    cursor: text;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  `;

  bar.addEventListener('mouseenter', () => {
    bar.style.borderColor = '#c4b5fd';
    bar.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.08)';
  });
  bar.addEventListener('mouseleave', () => {
    bar.style.borderColor = '#e5e7eb';
    bar.style.boxShadow = '0 1px 2px rgba(15, 23, 42, 0.04)';
  });

  // Pranan icon
  const icon = document.createElement('div');
  icon.style.cssText = `
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="33" stroke="#a78bfa" stroke-width="7" fill="none"/><circle cx="60" cy="60" r="16" fill="#a78bfa"/></svg>`;

  // Prompt input
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = senderName
    ? `Reply to ${senderName} with Pranan...`
    : 'Draft a reply with Pranan...';
  input.style.cssText = `
    flex: 1;
    border: none;
    background: transparent;
    outline: none;
    font-size: 13px;
    color: #1f2937;
    font-family: inherit;
    cursor: text;
  `;
  // Inject a <style> tag for placeholder color (can't set pseudo-element via .style)
  const placeholderStyle = document.createElement('style');
  placeholderStyle.textContent = `[${PRANAN_THREAD_BAR_ATTR}] input::placeholder { color: #94a3b8; }`;
  bar.appendChild(placeholderStyle);

  // Send / generate button
  const generateBtn = document.createElement('button');
  generateBtn.style.cssText = `
    background: linear-gradient(135deg, #6d28d9, #a78bfa);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
    font-family: inherit;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  `;
  generateBtn.textContent = 'Generate';
  generateBtn.addEventListener('mouseenter', () => { generateBtn.style.background = 'linear-gradient(135deg, #5b21b6, #8b5cf6)'; });
  generateBtn.addEventListener('mouseleave', () => { generateBtn.style.background = 'linear-gradient(135deg, #6d28d9, #a78bfa)'; });

  // Show generate button when input has text
  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    generateBtn.style.opacity = hasText ? '1' : '0';
    generateBtn.style.pointerEvents = hasText ? 'auto' : 'none';
  });

  const triggerDraft = () => {
    const prompt = input.value.trim() || undefined;
    safeSendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail: senderEmail,
        recipientName: senderName,
        messageToReplyTo: messageText,
        channelName: null,
        subject,
        prompt,
        originSurface: 'inline-bar',
        composeType: 'reply',
      },
    }).catch(() => {});
    // Visual feedback
    input.value = '';
    generateBtn.style.opacity = '0';
    generateBtn.style.pointerEvents = 'none';
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerDraft();
    }
  });

  generateBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerDraft();
  });

  // Also trigger on empty click (quick draft without prompt)
  bar.addEventListener('click', (e) => {
    if (e.target === bar || e.target === icon) {
      input.focus();
    }
  });

  bar.appendChild(icon);
  bar.appendChild(input);
  bar.appendChild(generateBtn);

  // Insert before the reply buttons row
  replyButtonsRow.parentElement?.insertBefore(bar, replyButtonsRow);
}

// ---------------------------------------------------------------------------
// Thread View Detection
// ---------------------------------------------------------------------------

let knownThreadViews = new Set<Element>();

function findThreadViews(): Element[] {
  // .h7 is the Gmail thread view container
  return findAll('gmail.threadView', SELECTORS.gmail.threadView);
}

/**
 * Returns the sender of whichever thread is currently open in the
 * reading pane (the most recently opened, most likely the visible one).
 *
 * Different from extractThreadSender which takes a specific container:
 * this one finds the right container by itself. Used by the side panel
 * + popup so they can show relationship context for whoever the user is
 * reading right now, not just whoever they're composing to.
 *
 * Returns null when no thread is open (eg. inbox list view).
 */
export function findOpenThreadSender(): { email: string | null; name: string | null; subject: string | null; preview: string | null } | null {
  const threads = findThreadViews();
  if (threads.length === 0) return null;

  // Gmail keeps multiple .h7 elements in the DOM as the user navigates,
  // but only one is actually visible. Find the visible one (it has
  // a non-zero offsetHeight). Fall back to the last one in the list,
  // which tends to be the most recently rendered.
  let visible: Element | null = null;
  for (const t of threads) {
    if ((t as HTMLElement).offsetHeight > 0) {
      visible = t;
      break;
    }
  }
  const target = visible || threads[threads.length - 1];

  const { email, name } = extractThreadSender(target);
  if (!email && !name) return null;

  return {
    email,
    name,
    subject: extractThreadSubject(target),
    preview: extractLatestMessageText(target)?.slice(0, 200) || null,
  };
}

function scanThreadViews() {
  const currentThreads = new Set(findThreadViews());

  for (const thread of currentThreads) {
    if (!knownThreadViews.has(thread)) {
      // New thread opened -- inject prompt bar + notify side panel
      setTimeout(() => injectThreadPromptBar(thread), 300);

      // Send THREAD_OPENED so side panel can show relationship context
      const { email: senderEmail, name: senderName } = extractThreadSender(thread);
      if (senderEmail || senderName) {
        safeSendMessage({
          type: 'THREAD_OPENED',
          payload: {
            platform: 'gmail',
            senderEmail,
            senderName,
            subject: extractThreadSubject(thread),
            messagePreview: extractLatestMessageText(thread)?.slice(0, 200) || null,
          },
        }).catch(() => {});
      }
    }
  }

  // knownThreadViews is replaced wholesale each scan -- stale DOM references
  // are dropped when they leave the set (no external cleanup needed).
  knownThreadViews = currentThreads;
}

// ---------------------------------------------------------------------------
// Text Selection Monitoring
// ---------------------------------------------------------------------------

function getSelectedText(): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const text = selection.toString().trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// Main Observer
// ---------------------------------------------------------------------------

function onComposeDetected(composeWindow: Element) {
  const recipients = extractRecipients(composeWindow);
  const primaryRecipient = recipients[0] || null;

  const prevRecipient = lastDetectedRecipientPerCompose.get(composeWindow) ?? null;
  if (primaryRecipient !== prevRecipient) {
    lastDetectedRecipientPerCompose.set(composeWindow, primaryRecipient);
  }

  safeSendMessage({
    type: 'COMPOSE_DETECTED',
    payload: {
      platform: 'gmail',
      recipientEmail: primaryRecipient,
      recipientName: null,
      threadId: null,
      messageToReplyTo: getThreadContext(composeWindow),
      channelName: null,
      isDM: false,
      selectedText: null,
      subject: getSubject(composeWindow),
    },
  }).catch(() => {});

  // Phase 1: Inject inline buttons near Send
  // Small delay to ensure Gmail has fully rendered the compose toolbar
  setTimeout(() => injectComposeButtons(composeWindow), 300);

  // Phase 2: Show relationship popup if we have a recipient
  if (primaryRecipient) {
    setTimeout(() => showComposeRelationshipPopup(composeWindow, primaryRecipient), 600);
  }

  // Phase 3: Attach suggestion monitor
  setTimeout(() => attachSuggestionMonitor(composeWindow), 1000);

  // Watch for recipient changes within this compose window
  const recipientObserver = new MutationObserver(() => {
    const newRecipients = extractRecipients(composeWindow);
    const newPrimary = newRecipients[0] || null;

    if (newPrimary && newPrimary !== lastDetectedRecipientPerCompose.get(composeWindow)) {
      lastDetectedRecipientPerCompose.set(composeWindow, newPrimary);
      safeSendMessage({
        type: 'RECIPIENT_CHANGED',
        payload: {
          recipientEmail: newPrimary,
          allRecipients: newRecipients,
        },
      }).catch(() => {});

      // Re-show relationship popup for new recipient
      showComposeRelationshipPopup(composeWindow, newPrimary);
    }

    // Re-inject buttons if Gmail re-rendered the toolbar
    injectComposeButtons(composeWindow);
  });

  const toContainer = findOne('gmail.toFieldContainer', SELECTORS.gmail.toFieldContainer, composeWindow);
  if (toContainer) {
    recipientObserver.observe(toContainer, { childList: true, subtree: true });
    activeComposeObservers.set(composeWindow, recipientObserver);
  }
}

function onComposeClosed(composeWindow: Element) {
  const observer = activeComposeObservers.get(composeWindow);
  if (observer) {
    observer.disconnect();
    activeComposeObservers.delete(composeWindow);
  }

  // Clean up suggestion monitor
  const cleanupSuggestions = activeSuggestionCleanups.get(composeWindow);
  if (cleanupSuggestions) {
    cleanupSuggestions();
    activeSuggestionCleanups.delete(composeWindow);
  }

  // Clean up floating button
  const floats = composeWindow.querySelectorAll(`[${PRANAN_FLOAT_ATTR}]`);
  floats.forEach(f => f.remove());
  // Also check parent containers
  const bodyContainer = findOne('gmail.composeBodyContainer', SELECTORS.gmail.composeBodyContainer, composeWindow);
  if (bodyContainer) {
    bodyContainer.querySelectorAll(`[${PRANAN_FLOAT_ATTR}]`).forEach(f => f.remove());
  }
  removeInjectedButtons(composeWindow);
  dismissRelationshipPopup();

  lastDetectedRecipientPerCompose.delete(composeWindow);

  safeSendMessage({
    type: 'COMPOSE_CLOSED',
    payload: { platform: 'gmail' },
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Selection listener
// ---------------------------------------------------------------------------

document.addEventListener('mouseup', () => {
  const selectedText = getSelectedText();
  if (selectedText && selectedText.length > 5) {
    safeSendMessage({
      type: 'TEXT_SELECTED',
      payload: { selectedText, platform: 'gmail' },
    }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Message listener (for draft injection from side panel)

/**
 * Click Gmail's Reply button in the active thread view to open the
 * reply compose. Returns true if clicked, false if not found.
 *
 * Used by the INSERT_DRAFT handler when the user clicks Insert in the
 * sidepanel before manually clicking Reply. Without this, Insert
 * appears broken — sidepanel had a draft ready, Gmail had no compose
 * to inject into, the call silently failed.
 */
function openGmailReply(): boolean {
  // Primary: structured selector path (fast when Gmail's classes match).
  const threads = findThreadViews();
  if (threads.length > 0) {
    const visible = threads[threads.length - 1];
    const replyRow = findOne('gmail.threadReplyButtons', SELECTORS.gmail.threadReplyButtons, visible);
    if (replyRow) {
      const candidates = Array.from(replyRow.querySelectorAll<HTMLElement>(
        '[role="button"], [role="link"], .ams'
      ));
      const reply = candidates.find(el => /^reply\b/i.test(el.textContent?.trim() || '')) || candidates[0];
      if (reply) {
        reply.click();
        return true;
      }
    }
  }

  // v0.8.12 fallback (reading-view one-tap bug): Gmail rotates classes and the
  // structured path can come up empty, which silently dropped generated drafts.
  // Find any VISIBLE Reply control by role + exact text and fire a bubbling
  // MouseEvent (some Gmail builds ignore a plain .click() here). This exact
  // approach was verified working against current Gmail.
  const all = Array.from(document.querySelectorAll<HTMLElement>(
    'span[role="link"], div[role="button"], span[role="button"]'
  ));
  const reply = all.find(el => /^reply$/i.test((el.textContent || '').trim()) && el.offsetParent !== null);
  if (reply) {
    reply.scrollIntoView({ block: 'center' });
    reply.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }
  return false;
}

// v0.8.12: when a generated draft arrives but no compose can be opened (or the
// compose never mounts in time), stash it for 60s and inject the moment ANY
// reply compose appears. Prevents silent draft loss in the reading view.
let pendingDraftText: string | null = null;
let pendingDraftTimer: ReturnType<typeof setTimeout> | null = null;
function stashPendingDraft(text: string) {
  pendingDraftText = text;
  if (pendingDraftTimer) clearTimeout(pendingDraftTimer);
  pendingDraftTimer = setTimeout(() => { pendingDraftText = null; }, 60000);
  const obs = new MutationObserver(() => {
    if (!pendingDraftText) { obs.disconnect(); return; }
    const wins = findComposeWindows();
    if (wins.length > 0) {
      const ok = injectDraft(wins[0], pendingDraftText);
      if (ok) { pendingDraftText = null; obs.disconnect(); }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 61000);
}

// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Liveness check from service worker (for SPA re-injection)
  if (message.type === 'PING') {
    sendResponse({ alive: true });
    return true;
  }
  // Popup "Quick Draft" — fire the active inline bar's Generate flow.
  if (message.type === 'TRIGGER_INLINE_DRAFT') {
    if (activeInlineGenerate) activeInlineGenerate();
    sendResponse({ ok: true, triggered: !!activeInlineGenerate });
    return true;
  }
  // Popup "Quick Grammar" — grammar runs in the side panel (the popup opens
  // it). Acknowledge so the sender's sendMessage does not reject.
  if (message.type === 'TRIGGER_INLINE_GRAMMAR') {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'INSERT_DRAFT') {
    const draftText = message.payload.text || message.payload.draft;
    // Editor binding (audit HIGH): if this draft was correlated to a specific
    // compose at request time, it must land THERE or nowhere. Never fall back
    // to composeWindows[0], which may be a different compose the user switched
    // to mid-flight.
    const boundEditorId = message.payload.editorId as string | undefined;
    if (boundEditorId) {
      const boundEl = resolveEditor(boundEditorId);
      const containerSelector = SELECTORS.gmail.composeWindow.join(', ');
      const boundCompose = boundEl
        ? (boundEl.closest(containerSelector) || boundEl.closest('.nH, .aoP, .aaZ') || boundEl)
        : null;
      if (!boundEl || !boundCompose || !document.contains(boundEl)) {
        // The originating compose is gone/changed. Surface a copy-fallback in
        // the inline bar instead of silently inserting into the wrong compose.
        try {
          chrome.runtime.onMessage.hasListeners?.();
        } catch { /* pass */ }
        window.dispatchEvent(new CustomEvent('pranan:editor-changed', { detail: { text: draftText } }));
        sendResponse({ success: false, reason: 'editor_changed' });
        return true;
      }
      const success = injectDraft(boundCompose, draftText);
      sendResponse({ success, reason: success ? undefined : 'inject_failed' });
      return true;
    }
    const composeWindows = findComposeWindows();
    if (composeWindows.length > 0) {
      const success = injectDraft(composeWindows[0], draftText);
      sendResponse({ success });
      return true;
    }
    // No compose window open. User is reading a thread and Pranan
    // pre-generated a draft (the most common Insert flow). Click
    // Gmail's Reply button programmatically, wait briefly for compose
    // to appear, then inject. Bug fix v0.5.5: previously this branch
    // just returned 'No compose window found' and the Insert button
    // appeared broken to users.
    const replyClicked = openGmailReply();
    if (!replyClicked) {
      // Keep the draft alive: inject as soon as the user opens a compose.
      stashPendingDraft(draftText);
      sendResponse({ success: false, error: 'No compose window and Reply button not found; draft stashed for 60s' });
      return true;
    }
    // Async wait + retry. We must return true synchronously to keep
    // the sendResponse channel open across the timeout.
    let attempts = 0;
    const tryInject = () => {
      const wins = findComposeWindows();
      if (wins.length > 0) {
        const success = injectDraft(wins[0], draftText);
        sendResponse({ success });
        return;
      }
      if (attempts < 20) {
        attempts++;
        setTimeout(tryInject, 100);
      } else {
        stashPendingDraft(draftText);
        sendResponse({ success: false, error: 'Reply opened but compose did not appear in 2s; draft stashed for 60s' });
      }
    };
    setTimeout(tryInject, 200);
    return true; // keep channel open for async sendResponse
  }
  if (message.type === 'DISMISS_POPUP') {
    dismissRelationshipPopup();
    sendResponse({ ok: true });
  }
  // Side panel asks for the currently open thread (read mode) so it
  // can show relationship context even when no compose window is open.
  if (message.type === 'GET_OPEN_THREAD_SENDER') {
    const opened = findOpenThreadSender();
    sendResponse({ opened });
    return true;
  }

  // Side panel requests current compose state on mount
  if (message.type === 'GET_COMPOSE_STATE') {
    const composeWindows = findComposeWindows();
    if (composeWindows.length > 0) {
      const win = composeWindows[0];
      const recipients = extractRecipients(win);
      const primaryRecipient = recipients[0] || null;
      const primaryName = primaryRecipient ? extractRecipientName(win, primaryRecipient) : null;
      sendResponse({
        hasCompose: true,
        payload: {
          platform: 'gmail',
          recipientEmail: primaryRecipient,
          recipientName: primaryName,
          threadId: null,
          messageToReplyTo: getThreadContext(win),
          channelName: null,
          isDM: false,
          selectedText: getSelectedText(),
          subject: getSubject(win),
        },
      });
    } else {
      // Debug aid: log when we can't find a compose window so users can diagnose
      console.log('[Pranan] No compose window detected. If you have a Reply open, Gmail may have updated DOM selectors. File an issue with the page URL.');
      sendResponse({ hasCompose: false });
    }
  }
  return true;
});

// ---------------------------------------------------------------------------
// Root MutationObserver -- watches for compose windows appearing/disappearing
// ---------------------------------------------------------------------------

let knownComposeWindows = new Set<Element>();

const rootObserver = new MutationObserver(() => {
  const currentWindows = new Set(findComposeWindows());

  // Detect new compose windows
  for (const win of currentWindows) {
    if (!knownComposeWindows.has(win)) {
      onComposeDetected(win);
    }
  }

  // Detect closed compose windows
  for (const win of knownComposeWindows) {
    if (!currentWindows.has(win)) {
      onComposeClosed(win);
    }
  }

  knownComposeWindows = currentWindows;

  // Also scan for thread views (for the "Draft with Pranan" prompt bar)
  scanThreadViews();
});

// ---------------------------------------------------------------------------
// Gmail Readiness Check (SPA may not be fully rendered at document_idle)
// ---------------------------------------------------------------------------

const GMAIL_READY_SELECTORS = [
  '.aeH',        // Main content pane
  '.nH.bkK',     // Navigation sidebar
  '[role="navigation"]',
];

const GMAIL_READY_MAX_WAIT = 15_000; // 15 seconds
const GMAIL_READY_POLL_INTERVAL = 500;

function isGmailReady(): boolean {
  return GMAIL_READY_SELECTORS.some(sel => document.querySelector(sel) !== null);
}

function waitForGmailReady(): Promise<void> {
  return new Promise((resolve) => {
    if (isGmailReady()) {
      resolve();
      return;
    }

    const start = Date.now();

    // Use MutationObserver + polling fallback for resilience
    const checkReady = () => {
      if (isGmailReady()) {
        clearInterval(pollId);
        readyObserver.disconnect();
        resolve();
        return true;
      }
      if (Date.now() - start > GMAIL_READY_MAX_WAIT) {
        clearInterval(pollId);
        readyObserver.disconnect();
        // Start anyway -- partial functionality beats no functionality
        console.warn('[Pranan] Gmail readiness timeout, starting anyway');
        resolve();
        return true;
      }
      return false;
    };

    const readyObserver = new MutationObserver(() => { checkReady(); });
    readyObserver.observe(document.documentElement, { childList: true, subtree: true });

    const pollId = setInterval(checkReady, GMAIL_READY_POLL_INTERVAL);
  });
}

// Start observing once Gmail's SPA is ready
async function init() {
  await waitForGmailReady();

  rootObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Check for any compose windows already open
  const existing = findComposeWindows();
  existing.forEach(win => {
    knownComposeWindows.add(win);
    onComposeDetected(win);
  });

  // SPA navigation: Gmail uses #inbox, #sent, #search/.../THREAD_ID, etc.
  // The rootObserver catches most compose pops, but Gmail occasionally
  // swaps an entire subtree (e.g. opening a thread from search results)
  // without firing the kind of mutation our observer reacts to. Re-running
  // detection on hashchange + popstate is a cheap safety net that picks up
  // any compose windows we missed and prunes any that closed during nav.
  //
  // Throttled to one detection per 250ms so a burst of nav events doesn't
  // saturate the main thread.
  let lastSpaCheck = 0;
  const onSpaNav = () => {
    const now = Date.now();
    if (now - lastSpaCheck < 250) return;
    lastSpaCheck = now;
    const currentWindows = new Set(findComposeWindows());
    for (const win of currentWindows) {
      if (!knownComposeWindows.has(win)) {
        onComposeDetected(win);
      }
    }
    for (const win of knownComposeWindows) {
      if (!currentWindows.has(win)) {
        onComposeClosed(win);
      }
    }
    knownComposeWindows = currentWindows;
    scanThreadViews();
  };
  window.addEventListener('hashchange', onSpaNav);
  window.addEventListener('popstate', onSpaNav);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}



