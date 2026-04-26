/**
 * LinkedIn Content Script
 *
 * Detects messaging compose, post compose, and comment reply areas.
 * LinkedIn's DOM is less stable than Slack's, requiring layered detection.
 *
 * ENHANCED (Phase 1-3 + Prompt Bar + Comment Drafting):
 * - Injects "Pranan" button next to Send (Voila/Loom pattern)
 * - Injects inline prompt bar below messaging compose (Gmail thread-bar style)
 * - Detects and injects prompt bar for LinkedIn post comment replies
 * - Extracts profile context (title, company, mutual connections)
 * - Detects InMail vs regular messaging
 * - Shows relationship popup on messaging compose open
 * - Monitors text for Grammarly-style suggestions
 */

// Content script -- IIFE bundling handles scope isolation

import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';

// ---------------------------------------------------------------------------
// Selectors (layered for resilience)
// ---------------------------------------------------------------------------

const SELECTORS = {
  // Messaging compose
  messageCompose: [
    '.msg-form__contenteditable',
    '[role="textbox"][aria-label*="message"]',
    '.msg-form [contenteditable="true"]',
  ],
  // Post compose
  postCompose: [
    '.share-creation-state__text-editor [contenteditable="true"]',
    '.ql-editor[data-placeholder*="What do you want to talk about"]',
    '[role="textbox"][aria-label*="post"]',
  ],
  // Comment compose (feed post comments)
  commentCompose: [
    '.comments-comment-texteditor [contenteditable="true"]',
    '.comments-comment-box__form [contenteditable="true"]',
    '[data-placeholder*="Add a comment"]',
    '.comments-comment-box [role="textbox"]',
  ],
  // Conversation header (messaging)
  conversationHeader: [
    '.msg-overlay-conversation-bubble__title',
    '.msg-thread__header-title',
    '.msg-s-message-list-container .msg-entity-lockup__entity-title',
  ],
  // Profile name in messaging
  profileName: [
    '.msg-entity-lockup__entity-title span',
    '.msg-overlay-bubble-header__title a',
  ],
  // Profile headline in messaging (title + company)
  profileHeadline: [
    '.msg-entity-lockup__entity-headline',
    '.msg-overlay-bubble-header__subtitle',
  ],
  // Send button
  sendButton: [
    '.msg-form__send-button',
    'button[type="submit"].msg-form__send-button',
  ],
  // Post submit button
  postSubmitButton: [
    '.share-actions__primary-action',
    'button.share-actions__primary-action',
  ],
  // Comment submit button
  commentSubmitButton: [
    '.comments-comment-box__submit-button',
    'button.comments-comment-box__submit-button',
  ],
  // Feed post container (for extracting post context for comments)
  feedPost: [
    '.feed-shared-update-v2',
    '.occludable-update',
  ],
  // Post author info
  postAuthor: [
    '.update-components-actor__title span[aria-hidden="true"]',
    '.feed-shared-actor__title span[aria-hidden="true"]',
    '.update-components-actor__name span[aria-hidden="true"]',
  ],
  // Post body text
  postBody: [
    '.feed-shared-update-v2__description .break-words',
    '.feed-shared-text .break-words',
    '.update-components-text .break-words',
  ],
  // InMail indicator
  inMailIndicator: [
    '.msg-overlay-bubble-header__inmail-badge',
    '[data-test-icon="premium"]',
    '.msg-inmail-badge',
  ],
  // Message history
  messageHistory: [
    '.msg-s-message-list-content .msg-s-event-listitem__body',
    '.msg-s-message-group__content .msg-s-event-listitem__body',
  ],
  // Messaging compose container (for bar positioning)
  messageFormContainer: [
    '.msg-form',
    '.msg-overlay-conversation-bubble__content-wrapper',
  ],
};

// ---------------------------------------------------------------------------
// Helper: try multiple selectors
// ---------------------------------------------------------------------------

function queryFirst(selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryAll(selectors: string[]): Element[] {
  const results: Element[] = [];
  for (const sel of selectors) {
    results.push(...document.querySelectorAll(sel));
  }
  return [...new Set(results)];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lastRecipientName: string | null = null;
let activeComposeType: 'message' | 'post' | 'comment' | null = null;
let suggestionCleanup: (() => void) | null = null;
let popupCache: Map<string, RelationshipPopupData> = new Map();

const PRANAN_LI_MSG_BAR_ATTR = 'data-pranan-li-msg-bar';
const PRANAN_LI_COMMENT_BAR_ATTR = 'data-pranan-li-comment-bar';

// ---------------------------------------------------------------------------
// Context Extraction
// ---------------------------------------------------------------------------

function getConversationRecipient(): string | null {
  const header = queryFirst(SELECTORS.profileName) || queryFirst(SELECTORS.conversationHeader);
  return header?.textContent?.trim() || null;
}

/**
 * Extract profile context from the messaging conversation partner.
 * Returns title, company, and whether this is InMail.
 */
function getProfileContext(): { headline: string | null; isInMail: boolean } {
  const headlineEl = queryFirst(SELECTORS.profileHeadline);
  const headline = headlineEl?.textContent?.trim() || null;
  const isInMail = !!queryFirst(SELECTORS.inMailIndicator);
  return { headline, isInMail };
}

function getMessageHistory(): string | null {
  const messages = document.querySelectorAll(
    SELECTORS.messageHistory.join(', ')
  );

  if (messages.length === 0) return null;

  const history = Array.from(messages)
    .slice(-5)
    .map(m => m.textContent?.trim())
    .filter(Boolean);

  return history.join('\n---\n').slice(0, 2000);
}

function getComposeContent(): string {
  const selectors = activeComposeType === 'post'
    ? SELECTORS.postCompose
    : activeComposeType === 'comment'
      ? SELECTORS.commentCompose
      : SELECTORS.messageCompose;

  const input = queryFirst(selectors);
  return input?.textContent?.trim() || '';
}

/**
 * Extract the feed post context when a user is commenting on a post.
 * Finds the nearest parent post container and extracts author + text.
 */
function getCommentPostContext(commentInput: Element): {
  postAuthor: string | null;
  postText: string | null;
  postUrl: string | null;
} {
  // Walk up from the comment input to find the containing feed post
  const postContainer = commentInput.closest(SELECTORS.feedPost.join(', '));
  if (!postContainer) return { postAuthor: null, postText: null, postUrl: null };

  // Extract author name
  let postAuthor: string | null = null;
  for (const sel of SELECTORS.postAuthor) {
    const el = postContainer.querySelector(sel);
    if (el?.textContent?.trim()) {
      postAuthor = el.textContent.trim();
      break;
    }
  }

  // Extract post body text
  let postText: string | null = null;
  for (const sel of SELECTORS.postBody) {
    const el = postContainer.querySelector(sel);
    if (el?.textContent?.trim()) {
      postText = el.textContent.trim().slice(0, 1500);
      break;
    }
  }

  // Try to extract the post URL from any share/permalink link
  const linkEl = postContainer.querySelector('a[href*="/feed/update/"]') as HTMLAnchorElement | null;
  const postUrl = linkEl?.href || null;

  return { postAuthor, postText, postUrl };
}

// ---------------------------------------------------------------------------
// Messaging Prompt Bar (Gmail thread-bar style)
// ---------------------------------------------------------------------------

function injectMessagingPromptBar() {
  // Find the messaging form container
  const msgForm = queryFirst(SELECTORS.messageFormContainer);
  if (!msgForm) return;

  // Don't inject twice
  if (document.querySelector(`[${PRANAN_LI_MSG_BAR_ATTR}]`)) return;

  const recipientName = getConversationRecipient();
  const { headline, isInMail } = getProfileContext();

  const bar = document.createElement('div');
  bar.setAttribute(PRANAN_LI_MSG_BAR_ATTR, 'true');
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 8px 6px 8px;
    background: #faf8ff;
    border: 1px solid rgba(167, 139, 250, 0.12);
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
    width: 22px; height: 22px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  `;
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

  // Build placeholder text
  let placeholderText = 'Draft message with Pranan...';
  if (recipientName) {
    placeholderText = isInMail
      ? `Draft InMail to ${recipientName} with Pranan...`
      : `Message ${recipientName} with Pranan...`;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholderText;
  input.style.cssText = `
    flex: 1; border: none; background: transparent; outline: none;
    font-size: 13px; color: #fafafa; font-family: inherit; cursor: text;
  `;

  // Placeholder style injection
  const placeholderStyle = document.createElement('style');
  placeholderStyle.textContent = `[${PRANAN_LI_MSG_BAR_ATTR}] input::placeholder { color: rgba(167, 139, 250, 0.5); }`;
  bar.appendChild(placeholderStyle);

  // Generate button
  const generateBtn = document.createElement('button');
  generateBtn.style.cssText = `
    background: linear-gradient(135deg, #6d28d9, #a78bfa); color: white; border: none; border-radius: 6px;
    padding: 4px 12px; font-size: 12px; font-weight: 500; cursor: pointer;
    transition: all 0.15s ease; font-family: inherit; white-space: nowrap;
    opacity: 0; pointer-events: none;
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
    background: none; border: none; cursor: pointer; padding: 2px;
    color: rgba(250,250,250,0.4); font-size: 14px; line-height: 1; display: flex; align-items: center;
  `;
  close.innerHTML = '&times;';
  close.title = 'Dismiss';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    bar.remove();
  });

  const triggerDraft = () => {
    const prompt = input.value.trim() || undefined;
    chrome.runtime.sendMessage({
      type: 'INLINE_DRAFT_REQUEST',
      payload: {
        platform: 'linkedin',
        recipientName,
        isDM: true,
        messageToReplyTo: getMessageHistory(),
        prompt,
        isInMail,
        profileHeadline: headline,
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

  // Insert before the message form
  msgForm.parentElement?.insertBefore(bar, msgForm);
}

// ---------------------------------------------------------------------------
// LinkedIn Comment Reply Prompt Bar
// ---------------------------------------------------------------------------

let knownCommentInputs = new WeakSet<Element>();

function injectCommentPromptBars() {
  const commentInputs = queryAll(SELECTORS.commentCompose);

  for (const commentInput of commentInputs) {
    if (knownCommentInputs.has(commentInput)) continue;
    knownCommentInputs.add(commentInput);

    // Find the comment form container
    const commentForm = commentInput.closest(
      '.comments-comment-box, .comments-comment-texteditor'
    );
    if (!commentForm) continue;

    // Don't inject twice on this form
    if (commentForm.querySelector(`[${PRANAN_LI_COMMENT_BAR_ATTR}]`)) continue;

    const { postAuthor, postText } = getCommentPostContext(commentInput);

    const bar = document.createElement('div');
    bar.setAttribute(PRANAN_LI_COMMENT_BAR_ATTR, 'true');
    bar.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      margin: 4px 0 2px 0;
      background: #faf8ff;
      border: 1px solid rgba(167, 139, 250, 0.12);
      border-radius: 6px;
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

    // Small Pranan icon
    const icon = document.createElement('div');
    icon.style.cssText = `
      width: 18px; height: 18px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    `;
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = postAuthor
      ? `Comment on ${postAuthor}'s post with Pranan...`
      : 'Draft comment with Pranan...';
    input.style.cssText = `
      flex: 1; border: none; background: transparent; outline: none;
      font-size: 12px; color: #fafafa; font-family: inherit; cursor: text;
      min-width: 0;
    `;

    // Placeholder style
    const placeholderStyle = document.createElement('style');
    placeholderStyle.textContent = `[${PRANAN_LI_COMMENT_BAR_ATTR}] input::placeholder { color: rgba(167, 139, 250, 0.5); }`;
    bar.appendChild(placeholderStyle);

    // Generate button
    const generateBtn = document.createElement('button');
    generateBtn.style.cssText = `
      background: linear-gradient(135deg, #6d28d9, #a78bfa); color: white; border: none; border-radius: 5px;
      padding: 3px 10px; font-size: 11px; font-weight: 500; cursor: pointer;
      transition: all 0.15s ease; font-family: inherit; white-space: nowrap;
      opacity: 0; pointer-events: none;
    `;
    generateBtn.textContent = 'Draft';
    generateBtn.addEventListener('mouseenter', () => { generateBtn.style.background = 'linear-gradient(135deg, #5b21b6, #8b5cf6)'; });
    generateBtn.addEventListener('mouseleave', () => { generateBtn.style.background = 'linear-gradient(135deg, #6d28d9, #a78bfa)'; });

    input.addEventListener('input', () => {
      const hasText = input.value.trim().length > 0;
      generateBtn.style.opacity = hasText ? '1' : '0';
      generateBtn.style.pointerEvents = hasText ? 'auto' : 'none';
    });

    // Close
    const close = document.createElement('button');
    close.style.cssText = `
      background: none; border: none; cursor: pointer; padding: 1px;
      color: rgba(250,250,250,0.4); font-size: 12px; line-height: 1; display: flex; align-items: center;
    `;
    close.innerHTML = '&times;';
    close.title = 'Dismiss';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      bar.remove();
    });

    const triggerCommentDraft = () => {
      const prompt = input.value.trim() || undefined;
      chrome.runtime.sendMessage({
        type: 'COMMENT_DRAFT_REQUEST',
        payload: {
          platform: 'linkedin',
          postAuthor,
          postText,
          prompt,
          composeType: 'comment',
        },
      }).catch(() => {});
      input.value = '';
      generateBtn.style.opacity = '0';
      generateBtn.style.pointerEvents = 'none';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        triggerCommentDraft();
      }
    });

    generateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerCommentDraft();
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

    // Insert the bar before the comment form
    commentForm.parentElement?.insertBefore(bar, commentForm);
  }
}

// ---------------------------------------------------------------------------
// Prompt bar cleanup
// ---------------------------------------------------------------------------

function removePromptBars() {
  document.querySelectorAll(`[${PRANAN_LI_MSG_BAR_ATTR}]`).forEach(el => el.remove());
  document.querySelectorAll(`[${PRANAN_LI_COMMENT_BAR_ATTR}]`).forEach(el => el.remove());
}

// ---------------------------------------------------------------------------
// Phase 1: Inline Compose Buttons
// ---------------------------------------------------------------------------

function injectComposeButtons() {
  // Try messaging send button first, then post submit
  const sendBtn = queryFirst(SELECTORS.sendButton) || queryFirst(SELECTORS.postSubmitButton);
  if (!sendBtn) return;
  if (hasInjectedButton(sendBtn, 'pranan-linkedin-main')) return;

  const isPost = activeComposeType === 'post';

  injectInlineButton(sendBtn, {
    id: 'pranan-linkedin-main',
    label: 'Pranan',
    title: isPost ? 'Draft post with Pranan AI' : 'Draft reply with Pranan AI',
    size: 'sm',
    position: 'before',
    onClick: () => {
      chrome.runtime.sendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'linkedin',
          recipientName: isPost ? null : getConversationRecipient(),
          isDM: !isPost,
          messageToReplyTo: isPost ? null : getMessageHistory(),
          channelName: isPost ? 'LinkedIn Post' : null,
          currentText: getComposeContent(),
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
              payload: { text: sel, platform: 'linkedin' },
            }).catch(() => {});
          }
        },
      },
      {
        label: 'Check grammar & tone',
        onClick: () => {
          const text = getComposeContent();
          if (text.length > 10) {
            chrome.runtime.sendMessage({
              type: 'INLINE_GRAMMAR_REQUEST',
              payload: { text, platform: 'linkedin' },
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
  if (activeComposeType !== 'message') return;

  const recipientName = getConversationRecipient();
  if (!recipientName) return;

  // Check cache first
  const cached = popupCache.get(recipientName);
  if (cached) {
    renderPopup(cached);
    return;
  }

  chrome.runtime.sendMessage({
    type: 'REQUEST_CONTACT_POPUP',
    payload: { name: recipientName, platform: 'linkedin' },
  }).then((response: { data?: RelationshipPopupData }) => {
    if (response?.data) {
      popupCache.set(recipientName, response.data);
      renderPopup(response.data);
    }
  }).catch(() => {});
}

function renderPopup(data: RelationshipPopupData) {
  const header = queryFirst(SELECTORS.profileName) || queryFirst(SELECTORS.conversationHeader);
  if (!header) return;

  showRelationshipPopup(header, data,
    // Draft click
    () => {
      chrome.runtime.sendMessage({
        type: 'INLINE_DRAFT_REQUEST',
        payload: {
          platform: 'linkedin',
          recipientName: data.contactName,
          isDM: true,
          messageToReplyTo: getMessageHistory(),
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

  const selectors = activeComposeType === 'post'
    ? SELECTORS.postCompose
    : SELECTORS.messageCompose;

  const input = queryFirst(selectors) as HTMLElement | null;
  if (!input) return;

  suggestionCleanup = createSuggestionMonitor({
    element: input,
    minLength: 40,
    debounceMs: 3000,
    onCheckRequested: async (text: string) => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'INLINE_GRAMMAR_CHECK',
          payload: { text, platform: 'linkedin' },
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

function detectActiveCompose() {
  // Check for messaging compose
  const messageInput = queryFirst(SELECTORS.messageCompose);
  if (messageInput) {
    const recipient = getConversationRecipient();

    if (activeComposeType !== 'message' || recipient !== lastRecipientName) {
      activeComposeType = 'message';
      lastRecipientName = recipient;

      const { headline, isInMail } = getProfileContext();

      chrome.runtime.sendMessage({
        type: 'COMPOSE_DETECTED',
        payload: {
          platform: 'linkedin',
          recipientEmail: null,
          recipientName: recipient,
          threadId: null,
          messageToReplyTo: getMessageHistory(),
          channelName: null,
          isDM: true,
          selectedText: null,
          isInMail,
          profileHeadline: headline,
        },
      }).catch(() => {});

      // Phase 1: Inject icon buttons + messaging prompt bar
      setTimeout(injectComposeButtons, 300);
      setTimeout(injectMessagingPromptBar, 400);

      // Phase 2: Show popup
      setTimeout(showComposeRelationshipPopup, 600);

      // Phase 3: Attach suggestion monitor
      setTimeout(attachSuggestionMonitor, 1000);
    }
    return;
  }

  // Check for post compose
  const postInput = queryFirst(SELECTORS.postCompose);
  if (postInput && activeComposeType !== 'post') {
    activeComposeType = 'post';
    lastRecipientName = null;

    chrome.runtime.sendMessage({
      type: 'COMPOSE_DETECTED',
      payload: {
        platform: 'linkedin',
        recipientEmail: null,
        recipientName: null,
        threadId: null,
        messageToReplyTo: null,
        channelName: 'LinkedIn Post',
        isDM: false,
        selectedText: null,
      },
    }).catch(() => {});

    // Phase 1: Inject buttons for post compose
    setTimeout(injectComposeButtons, 300);

    // Phase 3: Suggestion monitor for posts too
    setTimeout(attachSuggestionMonitor, 1000);
  }

  // Always scan for comment inputs (they can appear without affecting other compose types)
  injectCommentPromptBars();
}

// ---------------------------------------------------------------------------
// Draft Injection
// ---------------------------------------------------------------------------

function injectDraft(text: string): boolean {
  const selectors = activeComposeType === 'post'
    ? SELECTORS.postCompose
    : activeComposeType === 'comment'
      ? SELECTORS.commentCompose
      : SELECTORS.messageCompose;

  const input = queryFirst(selectors) as HTMLElement | null;
  if (!input) return false;

  input.focus();

  // LinkedIn messaging uses a rich text editor
  const paragraphs = text.split('\n').map(line =>
    `<p>${line || '<br>'}</p>`
  ).join('');

  input.innerHTML = paragraphs;
  input.dispatchEvent(new Event('input', { bubbles: true }));

  return true;
}

/**
 * Inject a comment draft into the comment input closest to the user's active area.
 */
function injectCommentDraft(text: string): boolean {
  // Find focused or most recent comment input
  const focused = document.activeElement;
  let commentInput: HTMLElement | null = null;

  if (focused) {
    const matchingSelector = SELECTORS.commentCompose.join(', ');
    if (focused.matches(matchingSelector) || focused.closest(matchingSelector)) {
      commentInput = (focused.closest(matchingSelector) || focused) as HTMLElement;
    }
  }

  // Fallback: use last comment input on page
  if (!commentInput) {
    const allInputs = queryAll(SELECTORS.commentCompose);
    commentInput = (allInputs[allInputs.length - 1] || null) as HTMLElement | null;
  }

  if (!commentInput) return false;

  commentInput.focus();
  commentInput.innerHTML = text.split('\n').map(line =>
    `<p>${line || '<br>'}</p>`
  ).join('');
  commentInput.dispatchEvent(new Event('input', { bubbles: true }));

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
        payload: { selectedText: text, platform: 'linkedin' },
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
  if (message.type === 'INSERT_COMMENT_DRAFT') {
    const success = injectCommentDraft(message.payload.text || message.payload.draft);
    sendResponse({ success });
  }
  return true;
});

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

function cleanupComposeElements() {
  dismissRelationshipPopup();
  // Only remove messaging prompt bars on compose close; comment bars persist in the feed
  document.querySelectorAll(`[${PRANAN_LI_MSG_BAR_ATTR}]`).forEach(el => el.remove());
  if (suggestionCleanup) {
    suggestionCleanup();
    suggestionCleanup = null;
  }
  // Remove injected buttons from all possible containers
  const sendBtns = [...queryAll(SELECTORS.sendButton), ...queryAll(SELECTORS.postSubmitButton)];
  for (const btn of sendBtns) {
    if (btn.parentElement) removeInjectedButtons(btn.parentElement);
  }
}

// ---------------------------------------------------------------------------
// Main Observer
// ---------------------------------------------------------------------------

function init() {
  // Watch for compose areas appearing
  const observer = new MutationObserver(() => {
    detectActiveCompose();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Monitor focus events
  document.addEventListener('focusin', (e) => {
    const target = e.target as Element;
    const isCompose = SELECTORS.messageCompose.some(s => target.matches(s) || target.closest(s)) ||
                      SELECTORS.postCompose.some(s => target.matches(s) || target.closest(s));
    const isComment = SELECTORS.commentCompose.some(s => target.matches(s) || target.closest(s));

    if (isCompose) {
      detectActiveCompose();
    }
    if (isComment) {
      // Set active compose type to 'comment' so getComposeContent works
      activeComposeType = 'comment';
      injectCommentPromptBars();
    }
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const stillActive = queryFirst(SELECTORS.messageCompose) || queryFirst(SELECTORS.postCompose);
      if (!stillActive && document.hasFocus()) {
        cleanupComposeElements();
        activeComposeType = null;
        lastRecipientName = null;
        chrome.runtime.sendMessage({
          type: 'COMPOSE_CLOSED',
          payload: { platform: 'linkedin' },
        }).catch(() => {});
      }
    }, 300);
  });

  // Initial check
  detectActiveCompose();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
