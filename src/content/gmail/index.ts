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

import { injectMultilineText } from '@/lib/safe-dom';
import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import type { InlineSuggestion } from '../shared/inline-suggestions';
import { bootstrapSentry } from '@/lib/observability';
import { findAll, findOne, SELECTORS } from '../selectors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


bootstrapSentry('content-gmail');

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
  injectMultilineText(body, draftText, 'div');

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

  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_BAR_ATTR, 'true');
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 0;
    background: rgba(250,250,250,0.04);
    border: 1px solid rgba(167, 139, 250, 0.12);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  `;

  bar.addEventListener('mouseenter', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.3)';
    bar.style.background = 'rgba(250,250,250,0.06)';
  });
  bar.addEventListener('mouseleave', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.12)';
    bar.style.background = 'rgba(250,250,250,0.04)';
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
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" rx="4" stroke="#a78bfa" stroke-width="1.5" opacity="0.3"/><rect x="5" y="5" width="14" height="14" rx="3" stroke="#a78bfa" stroke-width="1.5" opacity="0.5"/><rect x="8" y="8" width="8" height="8" rx="2" stroke="#a78bfa" stroke-width="1.5" opacity="0.7"/><rect x="10" y="10" width="4" height="4" rx="1" fill="#a78bfa"/></svg>`;

  // Prompt text
  const text = document.createElement('span');
  text.style.cssText = `
    font-size: 13px;
    color: #a78bfa;
    opacity: 0.6;
    flex: 1;
  `;
  text.textContent = 'Draft reply with Pranan...';

  // Close button
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

  // Click handler: trigger draft
  bar.addEventListener('click', () => {
    const recipientName = recipientEmail ? extractRecipientName(composeWindow, recipientEmail) : null;
    console.log('[Pranan] prompt-bar clicked', { recipientEmail, recipientName });
    chrome.runtime.sendMessage({
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

  // Insert before the compose container (so it appears above it, like Voila)
  composeContainer.parentElement?.insertBefore(bar, composeContainer);
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
  host.style.cssText = `
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
    vertical-align: middle;
  `;
  mountPrananToolbarButton(host, composeWindow, recipientEmail);
  // Place Pranan AFTER all existing toolbar buttons so it lands to the right
  // of Loom and Voila (which both inject after Send). Falls back to "after
  // Send" if the toolbar parent can't be resolved.
  const toolbarParent: HTMLElement | null = sendButton.parentElement;
  if (toolbarParent) {
    toolbarParent.appendChild(host);
  }
  return;
}

function mountPrananToolbarButton(host: HTMLElement, composeWindow: Element, recipientEmail: string | null) {

  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      .pranan-icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s ease;
        opacity: 0.45;
      }
      .pranan-icon-btn:hover {
        opacity: 1;
        background: rgba(167, 139, 250, 0.08);
      }
      .pranan-icon-btn svg {
        width: 14px;
        height: 14px;
      }
    </style>
    <button class="pranan-icon-btn" title="Draft with Pranan">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="20" height="20" rx="4" stroke="#a78bfa" stroke-width="1.5" opacity="0.3"/>
        <rect x="5" y="5" width="14" height="14" rx="3" stroke="#a78bfa" stroke-width="1.5" opacity="0.5"/>
        <rect x="8" y="8" width="8" height="8" rx="2" stroke="#a78bfa" stroke-width="1.5" opacity="0.7"/>
        <rect x="10" y="10" width="4" height="4" rx="1" fill="#a78bfa"/>
      </svg>
    </button>
  `;

  shadow.querySelector('.pranan-icon-btn')!.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const recipientName = recipientEmail ? extractRecipientName(composeWindow, recipientEmail) : null;
    console.log('[Pranan] toolbar icon clicked', { recipientEmail, recipientName });
    chrome.runtime.sendMessage({
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
  chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
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
        const response = await chrome.runtime.sendMessage({
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

  // Find the reply/forward button area at the bottom of the thread
  // Gmail uses .amn for the "Reply" / "Reply all" / "Forward" buttons row
  const replyButtonsRow = findOne('gmail.threadReplyButtons', SELECTORS.gmail.threadReplyButtons, threadContainer);
  if (!replyButtonsRow) return;

  const { email: senderEmail, name: senderName } = extractThreadSender(threadContainer);
  const subject = extractThreadSubject(threadContainer);
  const messageText = extractLatestMessageText(threadContainer);

  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_THREAD_BAR_ATTR, 'true');
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    margin: 8px 0 4px 0;
    background: rgba(250,250,250,0.04);
    border: 1px solid rgba(167, 139, 250, 0.12);
    border-radius: 8px;
    cursor: text;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  `;

  bar.addEventListener('mouseenter', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.3)';
    bar.style.background = 'rgba(250,250,250,0.06)';
  });
  bar.addEventListener('mouseleave', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.12)';
    bar.style.background = 'rgba(250,250,250,0.04)';
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
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" rx="4" stroke="#a78bfa" stroke-width="1.5" opacity="0.3"/><rect x="5" y="5" width="14" height="14" rx="3" stroke="#a78bfa" stroke-width="1.5" opacity="0.5"/><rect x="8" y="8" width="8" height="8" rx="2" stroke="#a78bfa" stroke-width="1.5" opacity="0.7"/><rect x="10" y="10" width="4" height="4" rx="1" fill="#a78bfa"/></svg>`;

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
    color: #fafafa;
    font-family: inherit;
    cursor: text;
  `;
  // Inject a <style> tag for placeholder color (can't set pseudo-element via .style)
  const placeholderStyle = document.createElement('style');
  placeholderStyle.textContent = `[${PRANAN_THREAD_BAR_ATTR}] input::placeholder { color: rgba(167, 139, 250, 0.5); }`;
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
    chrome.runtime.sendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail: senderEmail,
        recipientName: senderName,
        messageToReplyTo: messageText,
        channelName: null,
        subject,
        prompt,
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
        chrome.runtime.sendMessage({
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

  chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({
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

  chrome.runtime.sendMessage({
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
    chrome.runtime.sendMessage({
      type: 'TEXT_SELECTED',
      payload: { selectedText, platform: 'gmail' },
    }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Message listener (for draft injection from side panel)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Liveness check from service worker (for SPA re-injection)
  if (message.type === 'PING') {
    sendResponse({ alive: true });
    return true;
  }
  if (message.type === 'INSERT_DRAFT') {
    const composeWindows = findComposeWindows();
    if (composeWindows.length > 0) {
      const success = injectDraft(composeWindows[0], message.payload.text || message.payload.draft);
      sendResponse({ success });
    } else {
      sendResponse({ success: false, error: 'No compose window found' });
    }
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




