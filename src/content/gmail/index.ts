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

import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import type { InlineSuggestion } from '../shared/inline-suggestions';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
  const editables = document.querySelectorAll(
    '[contenteditable="true"][aria-label="Message Body"], ' +
    '.Am.aiL [contenteditable="true"], ' +
    '[contenteditable="true"][g_editable="true"]'
  );

  if (editables.length === 0) return [];

  const containers = new Set<Element>();
  for (const el of editables) {
    const container = el.closest('.AD, .M9, .nH.oy8Mbf, [role="dialog"], .ip.iq');
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

  // Method 1: data-hovercard-id attributes on recipient chips
  const chips = composeWindow.querySelectorAll('[data-hovercard-id]');
  chips.forEach(chip => {
    const email = chip.getAttribute('data-hovercard-id');
    if (email && email.includes('@')) {
      emails.push(email);
    }
  });

  // Method 2: email attribute on recipient elements (older Gmail)
  const emailEls = composeWindow.querySelectorAll('[email]');
  emailEls.forEach(el => {
    const email = el.getAttribute('email');
    if (email && email.includes('@')) {
      emails.push(email);
    }
  });

  // Method 3: Chip spans with data-tooltip containing email
  const tooltipChips = composeWindow.querySelectorAll(
    '.aoD [data-tooltip], .GS [data-tooltip], .afV [data-tooltip]'
  );
  tooltipChips.forEach(el => {
    const tooltip = el.getAttribute('data-tooltip') || '';
    const emailMatch = tooltip.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) emails.push(emailMatch[0]);
  });

  // Method 4: Chip spans with title attribute containing email
  const titleChips = composeWindow.querySelectorAll(
    '.aoD [title], .GS [title]'
  );
  titleChips.forEach(el => {
    const title = el.getAttribute('title') || '';
    const emailMatch = title.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) emails.push(emailMatch[0]);
  });

  // Method 5: Parse To input field value
  const toInputs = composeWindow.querySelectorAll(
    'input[aria-label*="To"], input[aria-label*="recipients"], input[name="to"]'
  );
  toInputs.forEach(input => {
    const value = (input as HTMLInputElement).value;
    const match = value.match(/[\w.+-]+@[\w.-]+\.\w+/g);
    if (match) emails.push(...match);
  });

  // Method 6: For reply windows, extract from the reply header
  if (emails.length === 0) {
    const replyHeader = composeWindow.closest('.h7, .gs, .nH');
    if (replyHeader) {
      const fromSpans = replyHeader.querySelectorAll('.go [email], .gD [email]');
      fromSpans.forEach(el => {
        const email = el.getAttribute('email');
        if (email && email.includes('@')) emails.push(email);
      });
    }
  }

  return [...new Set(emails)];
}

function getComposeBody(composeWindow: Element): string {
  const body = composeWindow.querySelector(
    '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
  );
  return body?.textContent?.trim() || '';
}

function getThreadContext(composeWindow: Element): string | null {
  const thread = composeWindow.closest('.h7, .gs');
  if (!thread) return null;

  const messages = thread.querySelectorAll('.a3s.aiL');
  if (messages.length === 0) return null;

  const lastMessage = messages[messages.length - 1];
  const text = lastMessage?.textContent?.trim();
  return text ? text.slice(0, 2000) : null;
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
  body.innerHTML = draftText.split('\n').map(line =>
    `<div>${line || '<br>'}</div>`
  ).join('');

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
    background: #faf8ff;
    border: 1px solid rgba(109, 40, 217, 0.12);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  `;

  bar.addEventListener('mouseenter', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.3)';
    bar.style.background = '#f5f0ff';
  });
  bar.addEventListener('mouseleave', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.12)';
    bar.style.background = '#faf8ff';
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
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

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
    chrome.runtime.sendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail,
        recipientName: null,
        messageToReplyTo: getThreadContext(composeWindow),
        channelName: null,
        subject: getSubject(composeWindow),
      },
    }).catch(() => {});
  });

  // Insert before the compose container (so it appears above it, like Voila)
  composeContainer.parentElement?.insertBefore(bar, composeContainer);
}

function injectFloatingIcon(composeWindow: Element, recipientEmail: string | null) {
  // Find the compose body
  const composeBody = composeWindow.querySelector(
    '[contenteditable="true"][aria-label="Message Body"], .Am.aiL [contenteditable="true"]'
  ) as HTMLElement | null;
  if (!composeBody) return;

  // Find a suitable positioned container
  const bodyContainer = composeBody.closest('.aO7, .Am, .aoP, .M9') || composeBody.parentElement;
  if (!bodyContainer) return;

  // Don't inject twice
  if (bodyContainer.querySelector(`[${PRANAN_FLOAT_ATTR}]`)) return;

  const containerEl = bodyContainer as HTMLElement;
  const currentPosition = window.getComputedStyle(containerEl).position;
  if (currentPosition === 'static') {
    containerEl.style.position = 'relative';
  }

  const host = document.createElement('div');
  host.setAttribute(PRANAN_FLOAT_ATTR, 'true');
  host.style.cssText = `
    position: absolute;
    bottom: 6px;
    right: 52px;
    z-index: 999;
  `;

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
      <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    </button>
  `;

  shadow.querySelector('.pranan-icon-btn')!.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'gmail',
        recipientEmail,
        recipientName: null,
        messageToReplyTo: getThreadContext(composeWindow),
        channelName: null,
        subject: getSubject(composeWindow),
      },
    }).catch(() => {});
  });

  containerEl.appendChild(host);
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
  const toField = composeWindow.querySelector('.aoD, .GS, [aria-label*="To"]');
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
  const senderEl = lastMessage.querySelector('.gD[email], .go[email], [data-hovercard-id]');
  const email = senderEl?.getAttribute('email') || senderEl?.getAttribute('data-hovercard-id') || null;

  // Extract sender name
  const nameEl = lastMessage.querySelector('.gD[name], .gD, .go');
  const name = nameEl?.getAttribute('name') || nameEl?.textContent?.trim() || null;

  return { email, name };
}

function extractThreadSubject(threadContainer: Element): string | null {
  const subjectEl = threadContainer.querySelector('.hP, h2.hP');
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
  const replyButtonsRow = threadContainer.querySelector('.amn');
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
    background: #faf8ff;
    border: 1px solid rgba(109, 40, 217, 0.12);
    border-radius: 8px;
    cursor: text;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  `;

  bar.addEventListener('mouseenter', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.3)';
    bar.style.background = '#f5f0ff';
  });
  bar.addEventListener('mouseleave', () => {
    bar.style.borderColor = 'rgba(167, 139, 250, 0.12)';
    bar.style.background = '#faf8ff';
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
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

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
  return Array.from(document.querySelectorAll('.h7'));
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

  const toContainer = composeWindow.querySelector('.aoD, .GS');
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
  const bodyContainer = composeWindow.querySelector('.aO7, .Am, .aoP, .M9');
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
  // Side panel requests current compose state on mount
  if (message.type === 'GET_COMPOSE_STATE') {
    const composeWindows = findComposeWindows();
    if (composeWindows.length > 0) {
      const win = composeWindows[0];
      const recipients = extractRecipients(win);
      const primaryRecipient = recipients[0] || null;
      sendResponse({
        hasCompose: true,
        payload: {
          platform: 'gmail',
          recipientEmail: primaryRecipient,
          recipientName: null,
          threadId: null,
          messageToReplyTo: getThreadContext(win),
          channelName: null,
          isDM: false,
          selectedText: getSelectedText(),
          subject: getSubject(win),
        },
      });
    } else {
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); });
} else {
  init();
}
