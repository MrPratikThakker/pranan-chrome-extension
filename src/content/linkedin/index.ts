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

import { injectMultilineText } from '@/lib/safe-dom';
import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import { bootstrapSentry } from '@/lib/observability';
import { findOne, findAll } from '../selectors';

// ---------------------------------------------------------------------------
// Selectors (layered for resilience)
// ---------------------------------------------------------------------------


bootstrapSentry('content-linkedin');

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
    // 2026 redesign: LinkedIn migrated to TipTap/ProseMirror. Class names
    // are now obfuscated hashes (a2dd5017, _2fcd7cb3, etc.) so we anchor
    // on stable signals: aria-label substring + data-testid wrapper.
    // Verified via DOM inspection on www.linkedin.com/feed on 2026-05-07.
    // Caveat: aria-label is locale-dependent (English: "creating comment").
    // Spanish/German/etc. surfaces may need a separate fallback in v0.5.
    '[contenteditable="true"][aria-label*="comment" i]',
    '[role="textbox"][aria-label*="comment" i]',
    '[data-testid="ui-core-tiptap-text-editor-wrapper"] [contenteditable="true"]',
    '[data-testid="ui-core-tiptap-text-editor-wrapper"] [role="textbox"]',
    // Legacy 2024 selectors. Keep as fallback for surfaces LinkedIn
    // hasn't migrated (some reply contexts, group comments).
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
  // Broadened 2026-05-10 — LinkedIn rotates these class names; the data-id
  // attribute is the most stable anchor, the rest are class-name fallbacks.
  feedPost: [
    '[data-id^="urn:li:activity"]',
    '[data-urn^="urn:li:activity"]',
    '.feed-shared-update-v2',
    '.occludable-update',
    '[data-finite-scroll-hotkey-context="FEED"]',
  ],
  // Post author info
  postAuthor: [
    '.update-components-actor__title span[aria-hidden="true"]',
    '.feed-shared-actor__title span[aria-hidden="true"]',
    '.update-components-actor__name span[aria-hidden="true"]',
    '.update-components-actor__name',
    '.feed-shared-actor__name',
    'span[class*="actor__title"] span[aria-hidden="true"]',
    'span[class*="actor__name"] span[aria-hidden="true"]',
  ],
  // Post body text
  // Order matters — most specific selectors first so we get the actual
  // post body, not stray text from comments or reactions.
  // Refreshed 2026-05-12 — LinkedIn rotated DOM again; added the newer
  // feed-shared-text + tap-target wrapper variants and a span[dir]
  // fallback so we degrade gracefully when class names change.
  postBody: [
    '.update-components-update-v2__commentary',
    '.feed-shared-update-v2__commentary',
    '.feed-shared-update-v2__description .break-words',
    '.feed-shared-inline-show-more-text',
    '.update-components-text .break-words',
    '.feed-shared-text .break-words',
    '.update-components-text',
    '[data-test-id="main-feed-activity-card-text"]',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.update-components-text-view',
    '.update-components-text-view .break-words',
    'div[dir="ltr"] > span',
    'span[dir="ltr"]',
    '.fie-impression-container span[dir="ltr"]',
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

function chainName(selectors: readonly string[]): string {
  // Use the first selector as a stable telemetry key. Sentry groups by the
  // captured message + breadcrumb name, so this gives one event per chain
  // rather than per individual selector inside it.
  const first = (selectors[0] || 'unknown').slice(0, 60);
  return `linkedin.${first.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
}

function queryFirst(selectors: string[]): Element | null {
  return findOne(chainName(selectors), selectors);
}

function queryAll(selectors: string[]): Element[] {
  const results = findAll(chainName(selectors), selectors);
  // Dedup since the original helper returned [...new Set(...)]
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
  postAuthorUrl: string | null;
  postText: string | null;
  postUrl: string | null;
} {
  // Walk up from the comment input to find the containing feed post
  const postContainer = commentInput.closest(SELECTORS.feedPost.join(', '));
  if (!postContainer) return { postAuthor: null, postAuthorUrl: null, postText: null, postUrl: null };

  // Extract author name
  let postAuthor: string | null = null;
  for (const sel of SELECTORS.postAuthor) {
    const el = postContainer.querySelector(sel);
    if (el?.textContent?.trim()) {
      postAuthor = el.textContent.trim();
      break;
    }
  }

  // Extract author profile URL — used by the backend to resolve the post
  // author against contact_styles.enriched_linkedin even if we've never
  // emailed them.
  let postAuthorUrl: string | null = null;
  const actorLinkSelectors = [
    '.update-components-actor__meta-link',
    '.feed-shared-actor__container-link',
    '.update-components-actor__container-link',
    'a.update-components-actor__name-link',
    'a[data-test-app-aware-link][href*="/in/"]',
    'a[href*="/in/"]',
  ];
  for (const sel of actorLinkSelectors) {
    const a = postContainer.querySelector(sel) as HTMLAnchorElement | null;
    if (a?.href && /linkedin\.com\/in\//i.test(a.href)) {
      // Strip query string + trailing slash so the handle is consistent
      // (linkedin.com/in/jane-doe instead of linkedin.com/in/jane-doe/?utm=...)
      const u = new URL(a.href);
      postAuthorUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}`;
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

  if (!postText) {
    // LinkedIn shifted DOM and our selectors couldn't find the post body.
    // Log so we know to update SELECTORS.postBody. Without this log the
    // backend silently falls back to "(post text not available)" and the
    // user gets a generic comment that doesn't reference the post.
    console.warn('[Pranan] LinkedIn post body not found — selectors may be stale. Comment will be generic.', {
      postContainer: postContainer?.className,
      hasAuthor: !!postAuthor,
    });
  }
  return { postAuthor, postAuthorUrl, postText, postUrl };
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
    background: linear-gradient(135deg, rgba(20,10,35,0.97), rgba(14,10,31,0.97));
    border: 1px solid rgba(167, 139, 250, 0.45); box-shadow: 0 2px 8px rgba(109,40,217,0.15);
    border-radius: 8px;
    cursor: text;
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

  // Pranan icon
  const icon = document.createElement('div');
  icon.style.cssText = `
    width: 22px; height: 22px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  `;
  icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="33" stroke="#a78bfa" stroke-width="7" fill="none"/><circle cx="60" cy="60" r="16" fill="#a78bfa"/></svg>`;

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
    color: #94a3b8; font-size: 14px; line-height: 1; display: flex; align-items: center;
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
        originSurface: 'inline-bar',
        composeType: 'reply',
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
      '[data-testid="ui-core-tiptap-text-editor-wrapper"], .comments-comment-box, .comments-comment-texteditor'
    );
    if (!commentForm) continue;

    // Don't inject twice on this form. The bar is inserted as a SIBLING
    // (commentForm.parentElement.insertBefore(bar, commentForm)), not inside,
    // so checking commentForm itself misses it. Mark the form on inject and
    // also scan the parent for any existing bar — defends against both
    // LinkedIn re-rendering the contenteditable (which invalidates the
    // WeakSet entry) and against the form being reused across nav.
    if (commentForm.hasAttribute('data-pranan-bar-injected')) continue;
    if (commentForm.parentElement?.querySelector(`:scope > [${PRANAN_LI_COMMENT_BAR_ATTR}]`)) {
      commentForm.setAttribute('data-pranan-bar-injected', 'true');
      continue;
    }

    const { postAuthor, postAuthorUrl, postText, postUrl } = getCommentPostContext(commentInput);

    const bar = document.createElement('div');
    bar.setAttribute(PRANAN_LI_COMMENT_BAR_ATTR, 'true');
    bar.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      margin: 4px 0 2px 0;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      border-radius: 6px;
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

    // Small Pranan icon
    const icon = document.createElement('div');
    icon.style.cssText = `
      width: 18px; height: 18px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    `;
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="33" stroke="#a78bfa" stroke-width="7" fill="none"/><circle cx="60" cy="60" r="16" fill="#a78bfa"/></svg>`;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = postAuthor
      ? `Comment on ${postAuthor}'s post with Pranan...`
      : 'Draft comment with Pranan...';
    input.style.cssText = `
      flex: 1; border: none; background: transparent; outline: none;
      font-size: 12px; color: #1f2937; font-family: inherit; cursor: text;
      min-width: 0;
    `;

    // Placeholder style
    const placeholderStyle = document.createElement('style');
    placeholderStyle.textContent = `[${PRANAN_LI_COMMENT_BAR_ATTR}] input::placeholder { color: #94a3b8; }`;
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
      color: #94a3b8; font-size: 14px; line-height: 1; display: flex; align-items: center;
    `;
    close.innerHTML = '&times;';
    close.title = 'Dismiss';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      bar.remove();
      commentForm.removeAttribute('data-pranan-bar-injected');
    });

    const triggerCommentDraft = () => {
      const prompt = input.value.trim() || undefined;
      // Re-extract post context at click time. The user may have scrolled
      // or LinkedIn may have re-rendered the post since the bar was
      // injected — refresh values so we don't ship stale or null context.
      const live = getCommentPostContext(commentInput);
      if (!live.postText && !prompt) {
        // No post context AND no user prompt — the AI has nothing to
        // anchor on, would produce a generic 'great post!' that defeats
        // the purpose. Surface a hint instead of silently failing.
        input.placeholder = 'Couldn\'t read the post. Type a prompt to draft anyway...';
        input.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        setTimeout(() => {
          input.style.borderColor = '';
          input.placeholder = live.postAuthor
            ? `Comment on ${live.postAuthor}'s post with Pranan...`
            : 'Draft comment with Pranan...';
        }, 3500);
        return;
      }
      chrome.runtime.sendMessage({
        type: 'COMMENT_DRAFT_REQUEST',
        payload: {
          platform: 'linkedin',
          postAuthor: live.postAuthor,
          postAuthorUrl: live.postAuthorUrl,
          postText: live.postText,
          postUrl: live.postUrl,
          prompt,
          composeType: 'comment',
          originSurface: 'inline-bar',
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
    // Mark the form so subsequent observer ticks skip the parent scan.
    commentForm.setAttribute('data-pranan-bar-injected', 'true');
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

  // LinkedIn messaging uses a rich text editor.
  injectMultilineText(input, text, 'p');
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
  injectMultilineText(commentInput, text, 'p');
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
  // Watch for compose areas appearing.
  //
  // CRITICAL fix per PRANAN_DEEP_AUDIT_COMBINED (2026-05-08): the previous
  // version called detectActiveCompose() on EVERY MutationObserver callback,
  // which on LinkedIn's feed fires dozens of times per second on scroll.
  // Each call did ~15 full-document querySelectorAll's. Result: CPU spikes
  // up to 100% on long sessions, fans spinning, users uninstalling.
  //
  // Now uses a 150ms trailing-edge debounce. The user-visible behavior is
  // identical (compose detection still happens; just batched). Worst-case
  // additional latency on detecting a NEW compose surface is 150ms, which
  // is below the human-perceptible threshold.
  let pendingDetect: ReturnType<typeof setTimeout> | null = null;
  const debouncedDetect = () => {
    if (pendingDetect !== null) clearTimeout(pendingDetect);
    pendingDetect = setTimeout(() => {
      pendingDetect = null;
      detectActiveCompose();
    }, 150);
  };
  const observer = new MutationObserver((mutations) => {
    // Pause heavy detection while tab is hidden — saves CPU on
    // long-lived background tabs.
    if (document.hidden) return;
    debouncedDetect();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Disconnect on tab unload so the observer doesn't outlive the page
  // (defensive — content scripts are reaped automatically, but this makes
  // the cleanup explicit and safe against multi-page SPA edge cases).
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
  }, { once: true });

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




