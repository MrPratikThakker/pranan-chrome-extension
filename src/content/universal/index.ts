/**
 * Universal Content Script (Phase 4)
 *
 * Runs on all URLs via host_permissions "<all_urls>".
 * Uses the universal text field detector to find compose fields
 * on any platform (HubSpot, Intercom, Zendesk, Notion, etc.)
 * and inject Pranan buttons.
 *
 * This script is lightweight: it only activates if no platform-specific
 * content script is loaded (Gmail, Slack, LinkedIn have their own).
 */

// Content script -- IIFE bundling handles scope isolation

import { injectMultilineText } from '@/lib/safe-dom';
import { monitorForTextFields, type DetectedField } from '../shared/universal-detector';
import { injectInlineButton, removeInjectedButtons, hasInjectedButton } from '../shared/inject-button';
import { showRelationshipPopup, dismissRelationshipPopup } from '../shared/relationship-popup';
import type { RelationshipPopupData } from '../shared/relationship-popup';
import { createSuggestionMonitor } from '../shared/inline-suggestions';
import { bootstrapSentry } from '@/lib/observability';

// ---------------------------------------------------------------------------
// Skip if a platform-specific script is already loaded
// ---------------------------------------------------------------------------


bootstrapSentry('content-universal');

const PLATFORM_URLS = [
  'mail.google.com',
  'app.slack.com',
  'www.linkedin.com',
  'app.pranan.ai',
];

function isPlatformPage(): boolean {
  const host = window.location.hostname;
  const href = window.location.href;
  return PLATFORM_URLS.some(p => href.includes(p) || host.includes(p));
}

if (isPlatformPage()) {
  // Platform-specific script handles this page
  // eslint-disable-next-line no-constant-condition
  if (true) { /* noop -- file must be a module */ }
} else {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const suggestionCleanups = new Map<HTMLElement, () => void>();

  // ---------------------------------------------------------------------------
  // Handle detected compose fields
  // ---------------------------------------------------------------------------

  function onFieldDetected(field: DetectedField) {
    const el = field.element;

    // Inject Pranan button near the field
    // Find nearest button-like element as anchor, or use the field itself
    const container = el.closest('form, [role="dialog"], [class*="compose"], [class*="editor"]') || el.parentElement;
    const anchor = container?.querySelector('button[type="submit"], [class*="send"], [aria-label*="Send"]') || el;

    if (hasInjectedButton(anchor, 'pranan-universal-main')) return;

    injectInlineButton(anchor, {
      id: 'pranan-universal-main',
      label: 'Pranan',
      title: 'Draft with Pranan AI',
      size: 'sm',
      position: anchor === el ? 'after' : 'before',
      onClick: () => {
        const text = el.textContent?.trim() || '';
        chrome.runtime.sendMessage({
          type: 'INLINE_DRAFT_REQUEST',
          payload: {
            platform: field.context.platform || 'universal',
            recipientName: null,
            channelName: field.context.platform || document.title,
            isDM: field.context.isChat || field.context.isEmail,
            messageToReplyTo: null,
            currentText: text,
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
                payload: { text: sel, platform: field.context.platform || 'universal' },
              }).catch(() => {});
            }
          },
        },
        {
          label: 'Check grammar & tone',
          onClick: () => {
            const text = el.textContent?.trim() || '';
            if (text.length > 10) {
              chrome.runtime.sendMessage({
                type: 'INLINE_GRAMMAR_REQUEST',
                payload: { text, platform: field.context.platform || 'universal' },
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

    // Attach suggestion monitor for qualifying fields
    if (field.score > 30 && !suggestionCleanups.has(el)) {
      const cleanup = createSuggestionMonitor({
        element: el,
        minLength: 50,
        debounceMs: 3000,
        onCheckRequested: async (text: string) => {
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'INLINE_GRAMMAR_CHECK',
              payload: { text, platform: field.context.platform || 'universal' },
            });
            return response?.suggestions || [];
          } catch {
            return [];
          }
        },
      });
      suggestionCleanups.set(el, cleanup);
    }

    // Send compose detected to side panel
    chrome.runtime.sendMessage({
      type: 'COMPOSE_DETECTED',
      payload: {
        platform: (field.context.platform || 'universal') as string,
        recipientEmail: null,
        recipientName: null,
        threadId: null,
        messageToReplyTo: null,
        channelName: field.context.platform || document.title,
        isDM: field.context.isChat || field.context.isEmail,
        selectedText: null,
      },
    }).catch(() => {});
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
          payload: { selectedText: text, platform: 'universal' },
        }).catch(() => {});
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Message Listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'INSERT_DRAFT') {
      const text = message.payload.text || message.payload.draft;
      // Try to find the most likely compose field and inject
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && (activeEl.getAttribute('contenteditable') === 'true' || activeEl.tagName === 'TEXTAREA')) {
        if (activeEl.tagName === 'TEXTAREA') {
          (activeEl as HTMLTextAreaElement).value = text;
        } else {
          injectMultilineText(activeEl, text, 'p');
        }
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    }
    return true;
  });

  // ---------------------------------------------------------------------------
  // Start monitoring
  // ---------------------------------------------------------------------------

  function init() {
    const cleanup = monitorForTextFields(onFieldDetected, 2000);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      cleanup();
      suggestionCleanups.forEach(fn => fn());
      suggestionCleanups.clear();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
