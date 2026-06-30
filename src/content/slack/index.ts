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
import { slackContextKey, slackBarIsStale } from './context-key';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import { injectMultilineText } from '@/lib/safe-dom';
import { stampEditor, resolveEditor } from '../shared/editor-binding';
import { findOne, findAll, SELECTORS as REGISTRY } from '../selectors';
import { bootstrapSentry } from '@/lib/observability';

// Smoke-test marker: lets external QA assert "Pranan content script booted
// on this page" without knowing surface-specific attribute names
// (2026-06-08 audit round 2 produced a false negative for lack of this).
try { document.documentElement.setAttribute('data-pranan-injected', chrome.runtime?.getManifest?.().version || 'true'); } catch { /* pass */ }


// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------


bootstrapSentry('content-slack');

// Derived from REGISTRY.slack.messageInput so the focusin matcher and
// the explicit findOne/findAll registry calls can never diverge again.
// Audit P1 finding (PRANAN_DEEP_AUDIT_COMBINED, 2026-05-08): the previous
// local SELECTORS.messageInput lacked the [data-qa="message_input"] [contenteditable]
// descendant variant that REGISTRY had, so a Slack UI rollout could break
// one path while leaving the other working — irreproducible flakiness.
const REGISTRY_MESSAGE_INPUT_JOINED = REGISTRY.slack.messageInput.join(', ');

const SELECTORS = {
  // Message input area — derived from REGISTRY (single source of truth).
  messageInput: REGISTRY_MESSAGE_INPUT_JOINED,
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
  const header = findOne('slack.channelHeader', REGISTRY.slack.channelHeader);
  return header?.textContent?.trim() || null;
}

function getDMRecipient(): string | null {
  // Try dedicated DM header selectors first
  const dmHeader = findOne('slack.dmHeader', REGISTRY.slack.dmHeader);
  if (dmHeader?.textContent?.trim()) return dmHeader.textContent.trim();

  // Fallback: in DMs, the channel header often shows the person's name
  if (isDirectMessage()) {
    const channelHeader = findOne('slack.channelHeader', REGISTRY.slack.channelHeader);
    if (channelHeader?.textContent?.trim()) return channelHeader.textContent.trim();
  }

  // Broader fallback: try registry chain for header title fallbacks.
  const fallback = findOne('slack.channelHeaderFallbacks', REGISTRY.slack.channelHeaderFallbacks);
  const fallbackText = fallback?.textContent?.trim();
  if (fallbackText && fallbackText.length > 0 && !fallbackText.startsWith('#')) {
    return fallbackText;
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
  if (findOne('slack.dmHeader', REGISTRY.slack.dmHeader)) return true;

  // Fallback: check if the channel header does NOT have a # prefix
  // (DMs show a person's name or avatar, channels show #channel-name)
  const channelHeader = findOne('slack.channelHeader', REGISTRY.slack.channelHeader);
  if (channelHeader) {
    const text = channelHeader.textContent?.trim() || '';
    // Channel names start with # in the header or have specific classes
    const isChannel = text.startsWith('#') ||
      channelHeader.closest('[data-qa="channel_sidebar_name_channel"]') !== null;
    if (!isChannel && text.length > 0) {
      // Could be a DM -- check if there's no channel member count (DMs don't show member counts)
      const memberCount = findOne('slack.channelMembers', REGISTRY.slack.channelMembers);
      if (!memberCount) return true;
    }
  }

  return false;
}

function getMessageInputContent(): string {
  const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
  return input?.textContent?.trim() || '';
}

function isInputFocused(): boolean {
  const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
  return document.activeElement === input ||
    (input?.contains(document.activeElement) ?? false);
}

function getThreadContext(): string | null {
  const threadPane = findOne('slack.threadContainer', REGISTRY.slack.threadContainer);
  if (!threadPane) return null;

  const messages = findAll('slack.threadMessageBody', REGISTRY.slack.threadMessageBody, threadPane);
  if (messages.length === 0) return null;

  // Get the last few messages for context
  const contextMessages = messages
    .slice(-5)
    .map((m: Element) => m.textContent?.trim())
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
  // Registry chain covers all selectors that were in the local strategy list.
  const messageEls = findAll('slack.recentMessages', REGISTRY.slack.recentMessages);
  if (messageEls.length === 0) return null;

  const messages: string[] = [];
  const last5 = messageEls.slice(-5);
  for (const el of last5) {
    // Try to find the sender name for this message
    // Walk up to find the message container, then look for sender
    // closest() needs a comma-joined string — registry chain has the same
    // entries; join them so the fallback semantics match.
    const messageKit = el.closest(REGISTRY.slack.messageKitContainer.join(', '));
    const senderEl = messageKit
      ? findOne('slack.messageSenderName', REGISTRY.slack.messageSenderName, messageKit)
      : null;
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
  const composeContainer = findOne('slack.composeContainer', REGISTRY.slack.composeContainer);
  if (!composeContainer) return;

  const isDM = isDirectMessage();
  const recipientName = isDM ? getDMRecipient() : null;
  const channelName = getChannelName();

  // Context-aware dedupe (QA 2026-06-12 fix for the Slack recipient
  // off-by-one). Slack is an SPA: when the user switches conversations, the
  // message input often re-renders BEFORE the header DOM updates, so the
  // first inject after navigation can capture the previous conversation's
  // recipient. The old guard returned early whenever ANY Pranan bar existed,
  // which froze that stale bar in place — every conversation then showed the
  // PREVIOUS one's recipient. Now we stamp the bar with the context it was
  // built for and only keep an existing bar if it still matches. If the
  // conversation changed, we drop the stale bar and rebuild with the live
  // recipient, which self-heals on the later staggered checks.
  const ctxKey = slackContextKey(isDM, recipientName, channelName);
  const existingBar = document.querySelector(`[${PRANAN_SLACK_BAR_ATTR}]`);
  if (existingBar) {
    if (!slackBarIsStale(existingBar.getAttribute('data-pranan-ctx'), ctxKey)) return;
    removeSlackPromptBar();
  }

  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_SLACK_BAR_ATTR, 'true');
  bar.setAttribute('data-pranan-ctx', ctxKey);
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 4px 16px 8px 16px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    border-radius: 8px;
    cursor: text;
    transition: all 0.15s ease;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, 'Slack-Lato', sans-serif;
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
    color: #1f2937;
    font-family: inherit;
    cursor: text;
  `;

  // Inject placeholder style
  const placeholderStyle = document.createElement('style');
  placeholderStyle.textContent = `[${PRANAN_SLACK_BAR_ATTR}] input::placeholder { color: #94a3b8; }`;
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
    color: #94a3b8;
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
    const editorId = stampEditor(findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput));
    // Show a loading state; keep the prompt text so we can restore it on error.
    pendingSlackDraft = { input, generateBtn, bar };
    input.disabled = true;
    generateBtn.textContent = 'Drafting...';
    generateBtn.style.opacity = '0.7';
    generateBtn.style.pointerEvents = 'none';
    chrome.runtime.sendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'slack',
        recipientName,
        channelName,
        isDM,
        messageToReplyTo: messageContext,
        // Send under both keys: the service worker reads userPrompt (gmail
        // convention); keep prompt for any legacy side-panel fallback.
        userPrompt: prompt,
        prompt,
        originSurface: 'inline-bar',
        composeType: 'reply',
        editorId,
      },
    }).catch(() => {
      // Message send itself failed: restore the bar so the user can retry.
      restoreSlackPromptBar('Could not reach Pranan. Try again.');
    });
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

// v0.8.22 (audit P1): track the active prompt bar so we can show a loading
// state and restore it on error instead of optimistically clearing it.
let pendingSlackDraft: { input: HTMLInputElement; generateBtn: HTMLButtonElement; bar: HTMLElement } | null = null;

function removeSlackPromptBar() {
  document.querySelectorAll(`[${PRANAN_SLACK_BAR_ATTR}]`).forEach(el => el.remove());
}

// Restore the active prompt bar from its loading state (e.g. after a skip or
// error) so the user can edit and retry, surfacing a short reason.
function restoreSlackPromptBar(message?: string): void {
  if (!pendingSlackDraft) return;
  const { input, generateBtn } = pendingSlackDraft;
  input.disabled = false;
  generateBtn.textContent = 'Generate';
  generateBtn.style.opacity = input.value.trim() ? '1' : '0';
  generateBtn.style.pointerEvents = input.value.trim() ? 'auto' : 'none';
  if (message) input.placeholder = message;
  pendingSlackDraft = null;
}

// ---------------------------------------------------------------------------
// Phase 1: Inline Compose Buttons
// ---------------------------------------------------------------------------

function injectComposeButtons() {
  const sendBtn = findOne<HTMLElement>('slack.sendButton', REGISTRY.slack.sendButton);
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
      // Bind to the active message input so the draft can only insert there
      // even if the user switches channels mid-flight (audit HIGH).
      const editorId = stampEditor(findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput));
      chrome.runtime.sendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'slack',
          recipientName: getDMRecipient(),
          channelName: getChannelName(),
          isDM: isDirectMessage(),
          messageToReplyTo: threadContext || channelContext,
          currentText: getMessageInputContent(),
          originSurface: 'inline-bar',
          composeType: 'reply',
          editorId,
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
  const header = findOne('slack.dmHeader', REGISTRY.slack.dmHeader);
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
          originSurface: 'inline-bar',
          composeType: 'reply',
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

  const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput) as HTMLElement | null;
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

function injectDraft(text: string, target?: HTMLElement | null): boolean {
  const input = target || (findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput) as HTMLElement | null);
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
    const draftText = message.payload.text || message.payload.draft;
    // Editor binding (audit HIGH): if this draft was bound to a specific
    // message input, only insert there. Do NOT fall back to the currently
    // active input, which may belong to a different channel.
    const boundEditorId = message.payload.editorId as string | undefined;
    if (boundEditorId) {
      const boundEl = resolveEditor(boundEditorId);
      if (!boundEl || !document.contains(boundEl)) {
        restoreSlackPromptBar('You switched channels, so Pranan did not insert here. Copy the draft instead.');
        sendResponse({ success: false, reason: 'editor_changed' });
        return true;
      }
      const ok = injectDraft(draftText, boundEl);
      if (ok && pendingSlackDraft) {
        pendingSlackDraft.bar.remove();
        pendingSlackDraft = null;
      } else if (!ok) {
        restoreSlackPromptBar('Could not insert draft. Try again.');
      }
      sendResponse({ success: ok, reason: ok ? undefined : 'inject_failed' });
      return true;
    }
    const success = injectDraft(draftText);
    if (success && pendingSlackDraft) {
      pendingSlackDraft.bar.remove();
      pendingSlackDraft = null;
    } else if (!success) {
      restoreSlackPromptBar('Could not insert draft. Try again.');
    }
    sendResponse({ success });
  }

  // Draft was skipped or errored upstream: restore the prompt with the reason.
  if (message.type === 'DRAFT_SKIPPED') {
    restoreSlackPromptBar(message.payload?.message || 'Draft skipped.');
    sendResponse({ ok: true });
  }

  // Service worker asks for current compose state when side panel opens
  if (message.type === 'GET_COMPOSE_STATE') {
    const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
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

  // SIDE_PANEL_READY: side panel just mounted; re-send compose context.
  // Migrated from the second (now-removed) onMessage listener per audit
  // P1 finding (PRANAN_DEEP_AUDIT_COMBINED, 2026-05-08): two listeners
  // in one content script means the response channel is nondeterministic.
  // Now only one listener exists and all broadcasts route through it.
  if (message.type === 'SIDE_PANEL_READY') {
    const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
    if (input) {
      lastChannel = null;
      lastRecipient = null;
      checkForActiveCompose(false);
    }
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
    const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
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
          const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
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
  // Bug fix v0.5.3: pause when tab is hidden (saves CPU/battery on long-lived
  // background tabs) and disconnect on beforeunload to avoid leaking the
  // interval handle across SPA navigations.
  let composePollHandle: number | null = null;
  const pollFn = () => {
    if (document.hidden) return; // tab not visible — skip work
    const input = findOne<HTMLElement>('slack.messageInput', REGISTRY.slack.messageInput);
    if (input && !lastInputDetected) {
      lastInputDetected = true;
      checkForActiveCompose(false);
    } else if (!input && lastInputDetected) {
      lastInputDetected = false;
    }
  };
  composePollHandle = window.setInterval(pollFn, 3000);
  window.addEventListener('beforeunload', () => {
    if (composePollHandle !== null) {
      clearInterval(composePollHandle);
      composePollHandle = null;
    }
  }, { once: true });

  // SIDE_PANEL_READY handling consolidated into the canonical onMessage
  // listener at the top of this module (audit P1 fix). Do NOT re-register
  // a second listener here — Chrome treats them as separate handlers and
  // each can send a response, causing nondeterministic delivery.
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}



