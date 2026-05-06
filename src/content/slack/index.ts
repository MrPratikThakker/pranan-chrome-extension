/**
 * Slack Content Script
 *
 * Detects message input fields, extracts channel/DM context,
 * and communicates with the service worker.
 *
 * ENHANCED (Phase 1-3 + Prompt Bar):
 * - Injects "Pranan" icon button next to Send (Voila/Loom pattern)
 * - Injects inline prompt bar below message input (Gmail thread-bar style)
 * - Shows relationship popup on DM compose open
 * - Monitors text for Grammarly-style suggestions
 * - Extracts recent channel messages for context-aware drafting
 */

// Content script -- IIFE bundling handles scope isolation

import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import { injectMultilineText } from '@/lib/safe-dom';
import { bootstrapSentry } from '@/lib/observability';

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------


bootstrapSentry('content-slack');

const SELECTORS = {
  // Message input area (layered for Slack DOM changes)
  messageInput: '[data-qa="message_input"], .ql-editor[data-placeholder], [contenteditable="true"][role="textbox"][aria-label*="Message"], [contenteditable="true"][data-placeholder*="Message"]',
  // Channel header with name
  channelHeader: '[data-qa="channel_name"], .p-view_header__channel_title, [data-qa="channel_header_title"]',
  // DM header (layered: direct match + sidebar active item)
  dmHeader: '[data-qa="conversation_header_name_text"], .p-view_header__channel_title button span, .p-ia__view_header__channel_topic_text',
  // Thread container
  threadContainer: '.p-flexpane__inside_body--scrollbar, [data-qa="threads_flexpane"]',
  // Channel type indicator
  channelType: '.p-channel_sidebar__channel--im, .p-channel_sidebar__channel--mpim',
  // Send button (layered)
  sendButton: '[data-qa="texty_send_button"], [aria-label="Send now"], button[data-qa="texty_send_button"]',
  // Toolbar area near send
  toolbar: '.c-wysiwyg_container__footer, [data-qa="message_input_footer"]',
  // Recent messages in channel/DM
  recentMessages: '.c-message_kit__message .c-message__body, .c-message_kit__blocks .c-message__body, [data-qa="message-text"]',
  // Message sender name
  messageSender: '.c-message_kit__sender [data-qa="message_sender_name"], [data-qa="message_sender_name"]',
  // Compose container (wrapper around input + toolbar)
  composeContainer: '.c-wysiwyg_container, [data-qa="message_input_container"], .p-message_input_field_container',
  // Channel participant count
  channelMembers: '[data-qa="channel_header_members"]',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lastChannel: string | null = null;
let lastRecipient: string | null = null;
let isInDM = false;
let suggestionCleanup: (() => void) | null = null;
let popupCache: Map<string, RelationshipPopupData> = new Map();

const PRANAN_SLACK_BAR_ATTR = 'data-pranan-slack-bar';

// ---------------------------------------------------------------------------
// Context Extraction
// ---------------------------------------------------------------------------

function getChannelName(): string | null {
  const header = document.querySelector(SELECTORS.channelHeader);
  return header?.textContent?.trim() || null;
}

function getDMRecipient(): string | null {
  // Try dedicated DM header selectors first
  const dmHeader = document.querySelector(SELECTORS.dmHeader);
  if (dmHeader?.textContent?.trim()) return dmHeader.textContent.trim();

  // Fallback: in DMs, the channel header often shows the person's name
  if (isDirectMessage()) {
    const channelHeader = document.querySelector(SELECTORS.channelHeader);
    if (channelHeader?.textContent?.trim()) return channelHeader.textContent.trim();
  }

  // Broader fallback: look for the header title in the view header area
  const headerCandidates = [
    '.p-view_header__channel_title',
    '[data-qa="channel-header-title"]',
    '.p-ia__view_header__channel_topic_text',
    '.p-ia__view_header .p-view_header__channel_title',
  ];
  for (const sel of headerCandidates) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 0 && !text.startsWith('#')) {
      return text;
    }
  }

  return null;
}

function isDirectMessage(): boolean {
  // Check URL pattern: /client/TEAM_ID/DMID starts with 'D'
  const path = window.location.pathname;
  const match = path.match(/\/client\/\w+\/(\w+)/);
  if (match) {
    // DM channel IDs start with 'D', group DMs with 'G'
    if (match[1].startsWith('D') || match[1].startsWith('G')) return true;
  }

  // Fallback: check for DM header element
  if (document.querySelector(SELECTORS.dmHeader)) return true;

  // Fallback: check if the channel header does NOT have a # prefix
  // (DMs show a person's name or avatar, channels show #channel-name)
  const channelHeader = document.querySelector(SELECTORS.channelHeader);
  if (channelHeader) {
    const text = channelHeader.textContent?.trim() || '';
    // Channel names start with # in the header or have specific classes
    const isChannel = text.startsWith('#') ||
      channelHeader.closest('[data-qa="channel_sidebar_name_channel"]') !== null;
    if (!isChannel && text.length > 0) {
      // Could be a DM -- check if there's no channel member count (DMs don't show member counts)
      const memberCount = document.querySelector(SELECTORS.channelMembers);
      if (!memberCount) return true;
    }
  }

  return false;
}

function getMessageInputContent(): string {
  const input = document.querySelector(SELECTORS.messageInput);
  return input?.textContent?.trim() || '';
}

function isInputFocused(): boolean {
  const input = document.querySelector(SELECTORS.messageInput);
  return document.activeElement === input ||
    (input?.contains(document.activeElement) ?? false);
}

function getThreadContext(): string | null {
  const threadPane = document.querySelector(SELECTORS.threadContainer);
  if (!threadPane) return null;

  const messages = threadPane.querySelectorAll('.c-message__body');
  if (messages.length === 0) return null;

  // Get the last few messages for context
  const contextMessages = Array.from(messages)
    .slice(-5)
    .map(m => m.textContent?.trim())
    .filter(Boolean);

  return contextMessages.join('\n---\n').slice(0, 2000);
}

/**
 * Extract recent messages from the main channel view for context-aware drafting.
 * Returns the last 5 messages with sender names.
 *
 * Uses multiple selector strategies because Slack's DOM varies by version:
 * - c-message__body: classic message body
 * - [data-qa="message-text"]: newer QA attribute
 * - .p-rich_text_section: rich text blocks in messages
 */
function getRecentChannelMessages(): string | null {
  // Try multiple selectors in order of specificity
  const selectorStrategies = [
    SELECTORS.recentMessages,
    '.c-message_kit__blocks [data-qa="message-text"]',
    '.c-message_kit__message .p-rich_text_section',
    '.c-virtual_list__item .c-message__body',
    '.c-virtual_list__item [data-qa="message-text"]',
  ];

  let messageEls: NodeListOf<Element> | null = null;
  for (const sel of selectorStrategies) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      messageEls = els;
      break;
    }
  }

  if (!messageEls || messageEls.length === 0) return null;

  const messages: string[] = [];
  const last5 = Array.from(messageEls).slice(-5);
  for (const el of last5) {
    // Try to find the sender name for this message
    // Walk up to find the message container, then look for sender
    const messageKit = el.closest(
      '.c-message_kit__message, .c-message_kit__blocks, .c-virtual_list__item, [data-qa="virtual-list-item"]'
    );
    const senderEl = messageKit?.querySelector(
      '[data-qa="message_sender_name"], .c-message__sender_button, .c-message_kit__sender button'
    );
    const sender = senderEl?.textContent?.trim() || 'Someone';
    const text = el.textContent?.trim();
    if (text) {
      messages.push(`${sender}: ${text}`);
    }
  }

  return messages.length > 0 ? messages.join('\n').slice(0, 2000) : null;
}

// ---------------------------------------------------------------------------
// Slack Prompt Bar (Gmail thread-bar style)
// ---------------------------------------------------------------------------

function injectSlackPromptBar() {
  // Find the compose container to inject below
  const composeContainer = document.querySelector(SELECTORS.composeContainer);
  if (!composeContainer) return;

  // Don't inject twice
  if (composeContainer.parentElement?.querySelector(`[${PRANAN_SLACK_BAR_ATTR}]`)) return;
  if (document.querySelector(`[${PRANAN_SLACK_BAR_ATTR}]`)) return;

  const isDM = isDirectMessage();
  const recipientName = isDM ? getDMRecipient() : null;
  const channelName = getChannelName();

  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_SLACK_BAR_ATTR, 'true');
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 16px 8px 16px;
    background: rgba(250,250,250,0.04);
    border: 1px solid rgba(167, 139, 250, 0.12);
    border-radius: 8px;
    cursor: text;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, 'Slack-Lato', sans-serif;
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

  // Input field
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = isDM && recipientName
    ? `Draft message to ${recipientName} with Pranan...`
    : channelName
      ? `Draft in #${channelName} with Pranan...`
      : 'Draft with Pranan...';
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

  // Inject placeholder style
  const placeholderStyle = document.createElement('style');
  placeholderStyle.textContent = `[${PRANAN_SLACK_BAR_ATTR}] input::placeholder { color: rgba(167, 139, 250, 0.5); }`;
  bar.appendChild(placeholderStyle);

  // Generate button (hidden until input has text)
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
    transition: all 0.15s ease;
    font-family: inherit;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
  `;
  generateBtn.textContent = 'Generate';
  generateBtn.addEventListener('mouseenter', () => { generateBtn.style.background = 'linear-gradient(135deg, #5b21b6, #8b5cf6)'; });
  generateBtn.addEventListener('mouseleave', () => { generateBtn.style.background = 'linear-gradient(135deg, #6d28d9, #a78bfa)'; });

  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    generateBtn.style.opacity = hasText ? '1' : '0';
    generateBtn.style.pointerEvents = hasText ? 'auto' : 'none';
  });

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

  const triggerDraft = () => {
    const prompt = input.value.trim() || undefined;
    const messageContext = getThreadContext() || getRecentChannelMessages();
    chrome.runtime.sendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'slack',
        recipientName,
        channelName,
        isDM,
        messageToReplyTo: messageContext,
        prompt,
      },
    }).catch(() => {});
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

  bar.addEventListener('click', (e) => {
    if (e.target === bar || e.target === icon) {
      input.focus();
    }
  });

  bar.appendChild(icon);
  bar.appendChild(input);
  bar.appendChild(generateBtn);
  bar.appendChild(close);

  // Insert after the compose container
  composeContainer.parentElement?.insertBefore(bar, composeContainer.nextSibling);
}

function removeSlackPromptBar() {
  document.querySelectorAll(`[${PRANAN_SLACK_BAR_ATTR}]`).forEach(el => el.remove());
}

// ---------------------------------------------------------------------------
// Phase 1: Inline Compose Buttons
// ---------------------------------------------------------------------------

function injectComposeButtons() {
  const sendBtn = document.querySelector(SELECTORS.sendButton);
  if (!sendBtn) return;
  if (hasInjectedButton(sendBtn, 'pranan-slack-main')) return;

  injectInlineButton(sendBtn, {
    id: 'pranan-slack-main',
    label: 'Pranan',
    title: 'Draft with Pranan AI',
    size: 'sm',
    position: 'before',
    onClick: () => {
      const threadContext = getThreadContext();
      const channelContext = getRecentChannelMessages();
      chrome.runtime.sendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'slack',
          recipientName: getDMRecipient(),
          channelName: getChannelName(),
          isDM: isDirectMessage(),
          messageToReplyTo: threadContext || channelContext,
          currentText: getMessageInputContent(),
        },
      }).catch(() => {});
    },
    secondaryActions: [
      {
        label: 'Rewrite selection',
        onClick: () => {
          const sel = window.getSelection()?.toString().trim();
          if (sel && sel.length > 5) {
            chrome.runtime.sendMessage({
              type: 'INLINE_REWRITE_REQUEST',
              payload: { text: sel, platform: 'slack' },
            }).catch(() => {});
          }
        },
      },
      {
        label: 'Check grammar & tone',
        onClick: () => {
          const text = getMessageInputContent();
          if (text.length > 10) {
            chrome.runtime.sendMessage({
              type: 'INLINE_GRAMMAR_REQUEST',
              payload: { text, platform: 'slack' },
            }).catch(() => {});
          }
        },
      },
      {
        label: 'Open side panel',
        onClick: () => {
          chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Phase 2: Relationship Popup
// ---------------------------------------------------------------------------

function showComposeRelationshipPopup() {
  if (!isDirectMessage()) return;

  const recipientName = getDMRecipient();
  if (!recipientName) return;

  // Check cache first
  const cached = popupCache.get(recipientName);
  if (cached) {
    renderPopup(cached);
    return;
  }

  // Request contact data from service worker
  chrome.runtime.sendMessage({
    type: 'REQUEST_CONTACT_POPUP',
    payload: { name: recipientName, platform: 'slack' },
  }).then((response: { data?: RelationshipPopupData }) => {
    if (response?.data) {
      popupCache.set(recipientName, response.data);
      renderPopup(response.data);
    }
  }).catch(() => {});
}

function renderPopup(data: RelationshipPopupData) {
  const header = document.querySelector(SELECTORS.dmHeader);
  if (!header) return;

  showRelationshipPopup(header, data,
    // Draft click
    () => {
      const threadContext = getThreadContext();
      const channelContext = getRecentChannelMessages();
      chrome.runtime.sendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'slack',
          recipientName: data.contactName,
          isDM: true,
          messageToReplyTo: threadContext || channelContext,
        },
      }).catch(() => {});
    },
    // View full click
    () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }).catch(() => {});
    }
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Suggestion Monitor
// ---------------------------------------------------------------------------

function attachSuggestionMonitor() {
  if (suggestionCleanup) {
    suggestionCleanup();
    suggestionCleanup = null;
  }

  const input = document.querySelector(SELECTORS.messageInput) as HTMLElement | null;
  if (!input) return;

  suggestionCleanup = createSuggestionMonitor({
    element: input,
    minLength: 40,
    debounceMs: 3000,
    onCheckRequested: async (text: string) => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'INLINE_GRAMMAR_CHECK',
          payload: { text, platform: 'slack' },
        });
        return response?.suggestions || [];
      } catch {
        return [];
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Compose Detection
// ---------------------------------------------------------------------------

function checkForActiveCompose(requireFocus = true) {
  if (requireFocus && !isInputFocused()) return;

  const channel = getChannelName();
  const isDM = isDirectMessage();
  const recipient = isDM ? getDMRecipient() : null;

  // Only send if something changed
  if (channel !== lastChannel || recipient !== lastRecipient || isDM !== isInDM) {
    lastChannel = channel;
    lastRecipient = recipient;
    isInDM = isDM;

    // Include recent channel messages for richer context
    const threadContext = getThreadContext();
    const channelContext = getRecentChannelMessages();
    const messageContext = threadContext || channelContext;

    chrome.runtime.sendMessage({
      type: 'COMPOSE_DETECTED',
      payload: {
        platform: 'slack',
        recipientEmail: null, // Slack doesn't expose emails in DOM
        recipientName: recipient,
        threadId: null,
        messageToReplyTo: messageContext,
        channelName: channel,
        isDM,
        selectedText: null,
      },
    }).catch(() => {});

    // Phase 1: Inject icon button near Send + inline prompt bar
    setTimeout(injectComposeButtons, 300);
    setTimeout(injectSlackPromptBar, 400);

    // Phase 2: Show popup for DMs
    if (isDM) {
      setTimeout(showComposeRelationshipPopup, 600);
    }

    // Phase 3: Attach suggestion monitor
    setTimeout(attachSuggestionMonitor, 1000);
  }
}

// ---------------------------------------------------------------------------
// Draft Injection
// ---------------------------------------------------------------------------

function injectDraft(text: string): boolean {
  const input = document.querySelector(SELECTORS.messageInput) as HTMLElement | null;
  if (!input) return false;

  input.focus();

  // Slack uses a Quill-like editor; one <p> block per line preserves
  // line breaks. We use injectMultilineText (textContent under the hood)
  // so any '<' / '>' / & in the draft is rendered as literal text instead
  // of HTML. Closes the residual XSS-shape vector that the safe-dom
  // commit (df39974c) missed for Slack.
  injectMultilineText(input, text, 'p');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  return true;
}

// ---------------------------------------------------------------------------
// Selection Monitoring
// ---------------------------------------------------------------------------

document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    const text = selection.toString().trim();
    if (text.length > 5) {
      chrome.runtime.sendMessage({
        type: 'TEXT_SELECTED',
        payload: { selectedText: text, platform: 'slack' },
      }).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// Message Listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'INSERT_DRAFT') {
    const success = injectDraft(message.payload.text || message.payload.draft);
    sendResponse({ success });
  }

  // Service worker asks for current compose state when side panel opens
  if (message.type === 'GET_COMPOSE_STATE') {
    const input = document.querySelector(SELECTORS.messageInput);
    if (input) {
      const isDM = isDirectMessage();
      const channel = getChannelName();
      const recipient = isDM ? getDMRecipient() : null;
      const threadContext = getThreadContext();
      const channelContext = getRecentChannelMessages();

      sendResponse({
        hasCompose: true,
        payload: {
          platform: 'slack',
          recipientEmail: null,
          recipientName: recipient,
          threadId: null,
          messageToReplyTo: threadContext || channelContext,
          channelName: channel,
          isDM,
          selectedText: null,
        },
      });
    } else {
      sendResponse({ hasCompose: false });
    }
  }

  if (message.type === 'PING') {
    sendResponse({ ok: true });
  }

  return true;
});

// ---------------------------------------------------------------------------
// URL Change Detection (Slack is an SPA)
// ---------------------------------------------------------------------------

let lastUrl = window.location.href;
let lastInputDetected = false;

const urlObserver = new MutationObserver(() => {
  // 1. URL change detection (SPA navigation)
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    lastChannel = null;
    lastRecipient = null;
    lastInputDetected = false;

    // Cleanup on navigation
    removeSlackPromptBar();
    removeInjectedButtons(document.body);
    dismissRelationshipPopup();
    if (suggestionCleanup) {
      suggestionCleanup();
      suggestionCleanup = null;
    }

    // Small delay for DOM to update after navigation
    setTimeout(() => checkForActiveCompose(false), 500);
    // Secondary check: Slack renders inputs async, so check again after a longer delay
    setTimeout(() => checkForActiveCompose(false), 1500);
    setTimeout(() => checkForActiveCompose(false), 3000);
  }

  // 2. Input element appearance detection (catches async-rendered inputs)
  // This fires on any DOM mutation, so we check cheaply with a flag
  if (!lastInputDetected) {
    const input = document.querySelector(SELECTORS.messageInput);
    if (input) {
      lastInputDetected = true;
      checkForActiveCompose(false);
    }
  }
});

// ---------------------------------------------------------------------------
// Focus/Input Monitoring
// ---------------------------------------------------------------------------

function init() {
  // Watch for URL changes AND DOM mutations (SPA navigation + async input rendering)
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // Monitor focus on message input -- use broader matching
  document.addEventListener('focusin', (e) => {
    const target = e.target as Element;
    if (target.matches?.(SELECTORS.messageInput) ||
        target.closest?.(SELECTORS.messageInput) ||
        target.matches?.('[contenteditable="true"]') ||
        target.getAttribute?.('role') === 'textbox') {
      checkForActiveCompose();
    }
  });

  // Monitor focus leaving message input
  document.addEventListener('focusout', (e) => {
    const target = e.target as Element;
    if (target.matches?.(SELECTORS.messageInput) || target.closest?.(SELECTORS.messageInput)) {
      setTimeout(() => {
        if (!isInputFocused() && document.hasFocus()) {
          // Cleanup Phase 1-3 elements + prompt bar
          const input = document.querySelector(SELECTORS.messageInput);
          if (input?.parentElement) {
            removeInjectedButtons(input.parentElement);
          }
          removeSlackPromptBar();
          dismissRelationshipPopup();

          chrome.runtime.sendMessage({
            type: 'COMPOSE_CLOSED',
            payload: { platform: 'slack' },
          }).catch(() => {});
        }
      }, 200);
    }
  });

  // Initial check: detect if a message input already exists on page load
  // Use staggered checks because Slack renders asynchronously
  setTimeout(() => checkForActiveCompose(false), 500);
  setTimeout(() => checkForActiveCompose(false), 1500);
  setTimeout(() => checkForActiveCompose(false), 3000);

  // Periodic fallback: check every 3 seconds for new inputs that MutationObserver may miss
  // (e.g., when Slack replaces its virtual DOM tree without standard mutations)
  setInterval(() => {
    const input = document.querySelector(SELECTORS.messageInput);
    if (input && !lastInputDetected) {
      lastInputDetected = true;
      checkForActiveCompose(false);
    } else if (!input && lastInputDetected) {
      lastInputDetected = false;
    }
  }, 3000);

  // Also listen for SIDE_PANEL_READY to re-send context
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SIDE_PANEL_READY') {
      const input = document.querySelector(SELECTORS.messageInput);
      if (input) {
        lastChannel = null;
        lastRecipient = null;
        checkForActiveCompose(false);
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

