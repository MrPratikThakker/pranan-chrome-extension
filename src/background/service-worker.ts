/**
 * Pranan Companion -- Service Worker (MV3)
 *
 * Handles:
 * - Auth token management (storage, refresh)
 * - Message routing between content scripts and side panel
 * - Tab tracking for platform detection
 * - Side panel lifecycle
 * - Keyboard shortcut commands
 * - Phase 1-5: Inline requests, contact popups, grammar checks,
 *   side panel opening, intelligence alerts
 */

import { validateAuth, getContactContext, generateDraft, rewriteText, checkGrammar } from '@/lib/api-client';
import type { ExtensionMessage, Platform, AuthResponse, ContactContext } from '@/types';

// ---------------------------------------------------------------------------
// State (persisted via chrome.storage, rebuilt on service worker restart)
// ---------------------------------------------------------------------------

let cachedAuth: AuthResponse | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// Pending-promise pattern to deduplicate concurrent validateAuth calls
let pendingValidation: Promise<AuthResponse> | null = null;

// ---------------------------------------------------------------------------
// Auth Management
// ---------------------------------------------------------------------------

/**
 * Deduplicated validateAuth: if a validation is already in-flight,
 * return that promise instead of firing a parallel one.
 */
async function deduplicatedValidateAuth(): Promise<AuthResponse> {
  if (pendingValidation) return pendingValidation;
  pendingValidation = validateAuth().finally(() => {
    pendingValidation = null;
  });
  return pendingValidation;
}

async function initAuth(): Promise<boolean> {
  try {
    const { authToken } = await chrome.storage.local.get('authToken');
    if (!authToken) return false;

    cachedAuth = await deduplicatedValidateAuth();
    scheduleTokenRefresh();
    return cachedAuth.valid;
  } catch {
    cachedAuth = null;
    return false;
  }
}

function scheduleTokenRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh every 25 minutes (tokens expire at 30)
  refreshTimer = setTimeout(async () => {
    try {
      cachedAuth = await deduplicatedValidateAuth();
      if (cachedAuth.valid) {
        scheduleTokenRefresh();
      } else {
        await chrome.storage.local.remove('authToken');
        broadcastToSidePanel({ type: 'AUTH_STATUS', payload: { valid: false } });
      }
    } catch {
      // Will retry on next API call
    }
  }, 25 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Platform Detection
// ---------------------------------------------------------------------------

function detectPlatform(url: string): Platform {
  if (url.includes('mail.google.com')) return 'gmail';
  if (url.includes('app.slack.com')) return 'slack';
  if (url.includes('linkedin.com')) return 'linkedin';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Contact Context Helper (for relationship popups)
// ---------------------------------------------------------------------------

const contactCache = new Map<string, { data: ContactContext; ts: number }>();
const CONTACT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CONTACT_CACHE_MAX = 100;

/**
 * LRU eviction: when cache exceeds max size, remove oldest entries.
 */
function evictContactCache() {
  if (contactCache.size <= CONTACT_CACHE_MAX) return;
  // Map iterates in insertion order; delete oldest entries
  const toDelete = contactCache.size - CONTACT_CACHE_MAX;
  let deleted = 0;
  for (const key of contactCache.keys()) {
    if (deleted >= toDelete) break;
    contactCache.delete(key);
    deleted++;
  }
}

async function getCachedContactContext(params: { email?: string; name?: string }): Promise<ContactContext | null> {
  const key = params.email || params.name || '';
  if (!key) return null;

  const cached = contactCache.get(key);
  if (cached && Date.now() - cached.ts < CONTACT_CACHE_TTL) {
    // Move to end for LRU (delete + re-set)
    contactCache.delete(key);
    contactCache.set(key, cached);
    return cached.data;
  }

  // Remove stale entry
  if (cached) contactCache.delete(key);

  try {
    const data = await getContactContext(params);
    contactCache.set(key, { data, ts: Date.now() });
    evictContactCache();
    return data;
  } catch {
    return null;
  }
}

function contactToPopupData(ctx: ContactContext, name: string): Record<string, unknown> {
  return {
    contactName: ctx.style.contactName || name,
    contactEmail: null,
    tier: ctx.tier,
    health: ctx.style.health,
    healthScore: ctx.style.healthScore,
    organization: ctx.style.organization,
    roleTitle: ctx.style.roleTitle,
    lastInteraction: ctx.lastInteraction,
    recentTopics: ctx.recentTopics,
    formality: ctx.communicationDNA
      ? (ctx.communicationDNA.formality > 0.7 ? 'Formal' : ctx.communicationDNA.formality > 0.4 ? 'Moderate' : 'Casual')
      : 'Unknown',
    avgLength: ctx.communicationDNA
      ? (ctx.communicationDNA.avgReplyLength > 200 ? 'Long' : ctx.communicationDNA.avgReplyLength > 80 ? 'Medium' : 'Short')
      : 'Unknown',
  };
}

// ---------------------------------------------------------------------------
// Message Routing
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage & { _fromSW?: boolean }, sender, sendResponse) => {
    // Ignore messages we broadcast ourselves (they echo back via chrome.runtime.sendMessage)
    if (message._fromSW) return;
    handleMessage(message, sender).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    // --- Core message forwarding ---
    case 'COMPOSE_DETECTED':
    case 'COMPOSE_CLOSED':
    case 'RECIPIENT_CHANGED':
    case 'TEXT_SELECTED':
      broadcastToSidePanel(message);
      return { ok: true };

    case 'AUTH_STATUS':
      return { auth: cachedAuth };

    case 'AUTH_EXPIRED': {
      // API client detected expired token. Clear it, reset cached auth, and
      // broadcast AUTH_STATUS to the side panel so it switches back to the
      // AuthPanel (otherwise the user sits in a stale context view forever).
      try {
        await chrome.storage.local.remove('authToken');
      } catch { /* pass */ }
      cachedAuth = null;
      broadcastToSidePanel({
        type: 'AUTH_STATUS',
        payload: { valid: false },
      });
      try {
        if (chrome.action && 'openPopup' in chrome.action) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (chrome.action as any).openPopup();
        }
      } catch { /* pass — openPopup unavailable on some platforms */ }
      return { ok: true };
    }

    case 'SIDE_PANEL_READY': {
      const isAuthed = await initAuth();
      const tab = sender.tab;
      const platform = tab?.url ? detectPlatform(tab.url) : 'unknown';

      // Check for any pending inline request that triggered the panel open
      const { pendingInlineRequest } = await chrome.storage.session.get('pendingInlineRequest');
      if (pendingInlineRequest && Date.now() - pendingInlineRequest.ts < 10000) {
        // Clear it and replay after a tick so the panel is fully mounted
        await chrome.storage.session.remove('pendingInlineRequest');
        setTimeout(() => {
          broadcastToSidePanel({
            type: pendingInlineRequest.type,
            payload: pendingInlineRequest.payload,
          });
        }, 300);
      } else {
        // No pending inline request -- ask the active tab's content script for
        // current compose state so the side panel can show context immediately
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, { type: 'GET_COMPOSE_STATE' }, (response) => {
              if (chrome.runtime.lastError) return; // No content script on this tab
              if (response?.hasCompose && response.payload) {
                broadcastToSidePanel({
                  type: 'COMPOSE_DETECTED',
                  payload: response.payload,
                });
              }
            });
          }
        } catch {
          // Tab query failed, not critical
        }
      }

      return {
        auth: cachedAuth,
        isAuthenticated: isAuthed,
        platform,
      };
    }

    // --- Phase 1: Inline compose buttons ---
    case 'INLINE_DRAFT_REQUEST': {
      // Open side panel FIRST, then broadcast after a delay so the
      // panel's message listener has time to initialize.
      const tab = sender.tab;
      if (tab?.id) {
        try { await chrome.sidePanel.open({ tabId: tab.id }); } catch { /* may already be open */ }
      }
      // Store the pending request so side panel can pick it up on SIDE_PANEL_READY too
      await chrome.storage.session.set({
        pendingInlineRequest: {
          type: 'INLINE_DRAFT_REQUEST',
          payload: message.payload,
          ts: Date.now(),
        },
      });
      // Broadcast after a short delay to give the panel time to mount
      setTimeout(() => {
        broadcastToSidePanel({
          type: 'INLINE_DRAFT_REQUEST',
          payload: message.payload,
        });
      }, 500);
      return { ok: true };
    }

    case 'INLINE_REWRITE_REQUEST': {
      const tab = sender.tab;
      if (tab?.id) {
        try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {}
      }
      await chrome.storage.session.set({
        pendingInlineRequest: {
          type: 'INLINE_REWRITE_REQUEST',
          payload: message.payload,
          ts: Date.now(),
        },
      });
      setTimeout(() => {
        broadcastToSidePanel({
          type: 'INLINE_REWRITE_REQUEST',
          payload: message.payload,
        });
      }, 500);
      return { ok: true };
    }

    case 'INLINE_GRAMMAR_REQUEST': {
      const tab = sender.tab;
      if (tab?.id) {
        try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {}
      }
      await chrome.storage.session.set({
        pendingInlineRequest: {
          type: 'INLINE_GRAMMAR_REQUEST',
          payload: message.payload,
          ts: Date.now(),
        },
      });
      setTimeout(() => {
        broadcastToSidePanel({
          type: 'INLINE_GRAMMAR_REQUEST',
          payload: message.payload,
        });
      }, 500);
      return { ok: true };
    }

    // --- Phase 6: LinkedIn comment drafting ---
    case 'COMMENT_DRAFT_REQUEST': {
      const tab = sender.tab;
      if (tab?.id) {
        try { await chrome.sidePanel.open({ tabId: tab.id }); } catch { /* may already be open */ }
      }
      await chrome.storage.session.set({
        pendingInlineRequest: {
          type: 'COMMENT_DRAFT_REQUEST',
          payload: message.payload,
          ts: Date.now(),
        },
      });
      setTimeout(() => {
        broadcastToSidePanel({
          type: 'COMMENT_DRAFT_REQUEST',
          payload: message.payload,
        });
      }, 500);
      return { ok: true };
    }

    // --- Phase 2: Contact popup ---
    case 'REQUEST_CONTACT_POPUP': {
      const { email, name } = (message.payload as { email?: string; name?: string }) || {};
      const ctx = await getCachedContactContext({ email, name });
      if (!ctx) return { data: null };
      return { data: contactToPopupData(ctx, name || email || 'Unknown') };
    }

    // --- Phase 3: Inline grammar check (from suggestion monitor) ---
    case 'INLINE_GRAMMAR_CHECK': {
      const { text, platform } = (message.payload as { text: string; platform: string }) || {};
      if (!text) return { suggestions: [] };
      try {
        const result = await checkGrammar({ text, platform });
        // Convert grammar corrections to InlineSuggestion format
        const suggestions = result.corrections.map((c, i) => ({
          id: `gs-${Date.now()}-${i}`,
          range: c.range,
          original: c.original,
          suggestion: c.suggestion,
          type: c.type,
          reason: c.reason,
        }));
        return { suggestions };
      } catch {
        return { suggestions: [] };
      }
    }

    // --- Phase 3: Grammar suggestions from content script ---
    case 'GRAMMAR_SUGGESTIONS': {
      broadcastToSidePanel(message);
      return { ok: true };
    }

    // --- Phase 4: Open side panel ---
    case 'OPEN_SIDE_PANEL': {
      const tab = sender.tab;
      if (tab?.id) {
        try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {}
      }
      return { ok: true };
    }

    // --- Auto-context: Thread opened (user reading an email) ---
    case 'THREAD_OPENED': {
      broadcastToSidePanel(message);
      return { ok: true };
    }

    // --- Phase 5: Intelligence ---
    case 'BRIEFING_REQUEST':
    case 'NUDGE_DETECTED':
    case 'DECAY_ALERT': {
      broadcastToSidePanel(message);
      return { ok: true };
    }

    // --- Auth token exchange ---
    case 'AUTH_TOKEN_FROM_WEB': {
      const token = message.token;
      if (!token) {
        console.warn('[SW] AUTH_TOKEN_FROM_WEB: no token provided');
        return { error: 'No token provided' };
      }

      console.log('[SW] AUTH_TOKEN_FROM_WEB: storing token and validating...');
      await chrome.storage.local.set({ authToken: token });

      try {
        cachedAuth = await deduplicatedValidateAuth();
        console.log('[SW] validateAuth result:', cachedAuth?.valid, cachedAuth?.userId);
      } catch (err) {
        console.error('[SW] validateAuth failed:', err);
        await chrome.storage.local.remove('authToken');
        cachedAuth = null;
        broadcastToSidePanel({
          type: 'AUTH_STATUS',
          payload: { valid: false },
        });
        return { error: 'Token validation failed' };
      }

      if (cachedAuth?.valid) {
        scheduleTokenRefresh();
        broadcastToSidePanel({
          type: 'AUTH_STATUS',
          payload: { valid: true, user: cachedAuth },
        });
        console.log('[SW] Auth successful, broadcast sent to side panel');
        return { ok: true };
      } else {
        console.warn('[SW] Token stored but validation returned invalid');
        await chrome.storage.local.remove('authToken');
        broadcastToSidePanel({
          type: 'AUTH_STATUS',
          payload: { valid: false },
        });
        return { error: 'Token invalid' };
      }
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

function broadcastToSidePanel(message: ExtensionMessage) {
  console.log('[SW] Broadcasting to side panel:', message.type);
  // Tag the message so the service worker's own onMessage handler can
  // ignore it (chrome.runtime.sendMessage reaches ALL extension listeners,
  // including this service worker itself).
  chrome.runtime.sendMessage({ ...message, _fromSW: true }).catch(() => {
    // No side panel open to receive broadcast
  });
}

// ---------------------------------------------------------------------------
// Tab Events -- track active platform
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const platform = detectPlatform(tab.url);
      broadcastToSidePanel({
        type: 'PLATFORM_DETECTED',
        payload: { platform, tabId: activeInfo.tabId },
      });
    }
  } catch {
    // Tab might have been closed
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    const platform = detectPlatform(changeInfo.url);
    broadcastToSidePanel({
      type: 'PLATFORM_DETECTED',
      payload: { platform, tabId },
    });
  }
});

// ---------------------------------------------------------------------------
// Keyboard Shortcut
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-pranan') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

// ---------------------------------------------------------------------------
// External Messages (from app.pranan.ai for auth token exchange)
// ---------------------------------------------------------------------------

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (sender.origin !== 'https://app.pranan.ai') {
      sendResponse({ error: 'Unauthorized origin' });
      return;
    }

    if (message.type === 'AUTH_TOKEN') {
      // Handle async work inside a then-chain so we can return true synchronously
      // to keep the sendResponse channel open (Chrome closes it if the listener returns)
      (async () => {
        console.log('[SW] AUTH_TOKEN (external): storing token...');
        await chrome.storage.local.set({ authToken: message.token });

        try {
          cachedAuth = await deduplicatedValidateAuth();
          console.log('[SW] External validateAuth result:', cachedAuth?.valid);
        } catch (err) {
          console.error('[SW] External validateAuth failed:', err);
          await chrome.storage.local.remove('authToken');
          broadcastToSidePanel({
            type: 'AUTH_STATUS',
            payload: { valid: false },
          });
          sendResponse({ error: 'Validation failed' });
          return;
        }

        if (cachedAuth?.valid) {
          scheduleTokenRefresh();
          broadcastToSidePanel({
            type: 'AUTH_STATUS',
            payload: { valid: true, user: cachedAuth },
          });
          sendResponse({ ok: true });
        } else {
          await chrome.storage.local.remove('authToken');
          broadcastToSidePanel({
            type: 'AUTH_STATUS',
            payload: { valid: false },
          });
          sendResponse({ error: 'Token invalid' });
        }
      })();
    }

    return true; // Keep sendResponse channel open for async work
  }
);

// ---------------------------------------------------------------------------
// SPA Re-injection (webNavigation)
// Gmail is an SPA -- content scripts only run once on initial load.
// When the user navigates within Gmail (inbox -> thread -> compose),
// the URL changes via History API but no new page load fires.
// We use webNavigation.onHistoryStateUpdated to re-inject when needed.
// ---------------------------------------------------------------------------

chrome.webNavigation?.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return; // Only top frame
    // Re-inject the content script by sending a ping; if it fails, inject programmatically
    chrome.tabs.sendMessage(details.tabId, { type: 'PING' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Content script not running -- re-inject
        chrome.scripting?.executeScript({
          target: { tabId: details.tabId },
          files: ['content/gmail.js'],
        }).catch(() => {
          // May fail if page isn't ready yet -- that's OK
        });
      }
    });
  },
  { url: [{ hostContains: 'mail.google.com' }] }
);

// ---------------------------------------------------------------------------
// Service Worker Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ hasSeenOnboarding: false, interactionCount: 0 });
  }

  // Enable side panel on all supported sites
  await chrome.sidePanel.setOptions({
    enabled: true,
  });
});

// ---------------------------------------------------------------------------
// Persistent Token Refresh (survives service worker restarts via chrome.alarms)
// ---------------------------------------------------------------------------

chrome.alarms.create('pranan-token-refresh', { periodInMinutes: 360 }); // Every 6 hours

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'pranan-token-refresh') {
    try {
      const { authToken } = await chrome.storage.local.get('authToken');
      if (!authToken) return;

      cachedAuth = await deduplicatedValidateAuth();
      if (!cachedAuth?.valid) {
        await chrome.storage.local.remove('authToken');
        broadcastToSidePanel({ type: 'AUTH_STATUS', payload: { valid: false } });
      }
    } catch {
      // Silent -- will retry next alarm
    }
  }
});

// Re-init auth eagerly on service worker startup
initAuth();
