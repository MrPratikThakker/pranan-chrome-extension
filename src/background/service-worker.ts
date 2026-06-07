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

import { validateAuth, getContactContext, generateDraft, rewriteText, checkGrammar, getProactiveSuggestions, getReplyIntents, setTierOverride } from '@/lib/api-client';
import type { ExtensionMessage, Platform, AuthResponse, ContactContext } from '@/types';
import { bootstrapSentry } from '@/lib/observability';
import { APP_ORIGIN } from '@/lib/config';

// ---------------------------------------------------------------------------
// State (persisted via chrome.storage, rebuilt on service worker restart)
// ---------------------------------------------------------------------------


bootstrapSentry('service-worker');

let cachedAuth: AuthResponse | null = null;

// MV3 service workers terminate after ~30s idle, which kills setTimeout-based
// refresh. chrome.alarms persists across SW restarts so the 25-min refresh
// fires reliably even on long-idle tabs. Alarm name is namespaced so other
// alarms don't collide.
const REFRESH_ALARM_NAME = 'pranan-token-refresh';

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
  // v0.4.0+: cookie-based auth means we must always call validateAuth.
  // The legacy stored Bearer token is no longer the gate; the user may be
  // signed into app.pranan.ai (cookie present) without any stored token.
  try {
    cachedAuth = await deduplicatedValidateAuth();
    if (cachedAuth.valid) scheduleTokenRefresh();
    return cachedAuth.valid;
  } catch {
    cachedAuth = null;
    return false;
  }
}

function scheduleTokenRefresh() {
  // chrome.alarms minimum interval is 0.5 minutes (30s) on production, 30s
  // for periodic. We refresh every 25 min — well above the floor. The alarm
  // is recreated each call so the timer resets after a successful refresh.
  chrome.alarms.create(REFRESH_ALARM_NAME, { delayInMinutes: 25 });
}

// Single registration point for the alarm handler. Survives SW restarts:
// when Chrome wakes the SW to fire the alarm, this listener fires the same
// refresh logic that the old setTimeout used to run.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM_NAME) return;
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
});

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

    case 'AUTH_RECOVERED': {
      // API client detected a successful response after a recent 401.
      // Re-validate auth so cachedAuth picks up a real user object,
      // then broadcast AUTH_STATUS valid:true so the side panel clears
      // its 'Not authenticated' error state. Best-effort: if validation
      // itself fails (e.g., the success was a stale 200 cached response),
      // we just leave the banner state as-is and the next real failure
      // will refresh it.
      try {
        cachedAuth = await deduplicatedValidateAuth();
        if (cachedAuth.valid) {
          broadcastToSidePanel({
            type: 'AUTH_STATUS',
            payload: { valid: true, user: cachedAuth },
          });
        }
      } catch { /* validation hiccup; leave state unchanged */ }
      return { ok: true };
    }

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
      const tab = sender.tab;
      const inlinePayload = message.payload as {
        platform?: string;
        recipientEmail?: string;
        recipientName?: string;
        channelName?: string;
        messageToReplyTo?: string;
        userPrompt?: string;
        originSurface?: 'inline-bar' | 'sidepanel' | 'popover';
        composeType?: 'comment' | 'reply' | 'new';
      };

      // v0.8.9 (F-15b) — Gmail inline bar: generate the draft HERE in the
      // service worker and insert it directly into the compose, independent
      // of the side panel. The previous flow routed generation through the
      // panel (sidePanel.open -> panel requestDraft -> auto-INSERT_DRAFT),
      // which made one-tap intermittently fail when the panel was not open
      // or had not mounted in time (chrome.sidePanel.open() from the worker
      // is unreliable after the content-script gesture hop). Generating here
      // removes that dependency and is faster. The content script already
      // has a top-level INSERT_DRAFT handler that injects the text (and even
      // opens Reply if no compose is open). Scoped to gmail (the surface QA'd
      // live); other platforms keep the existing panel path below.
      if (
        inlinePayload.originSurface === 'inline-bar' &&
        inlinePayload.platform === 'gmail' &&
        tab?.id
      ) {
        const tabId = tab.id;
        const insertType = inlinePayload.composeType === 'comment'
          ? 'INSERT_COMMENT_DRAFT'
          : 'INSERT_DRAFT';
        (async () => {
          try {
            const resp = await generateDraft({
              recipientEmail: inlinePayload.recipientEmail || undefined,
              recipientName: inlinePayload.recipientName || undefined,
              messageToReplyTo: inlinePayload.messageToReplyTo || undefined,
              platform: inlinePayload.platform,
              channelName: inlinePayload.channelName || undefined,
              prompt: inlinePayload.userPrompt || undefined,
            });
            if (resp?.skipped) {
              chrome.tabs.sendMessage(tabId, {
                type: 'DRAFT_SKIPPED',
                payload: {
                  reason: resp.skipReason || 'skipped',
                  message: resp.skipMessage || 'Draft skipped.',
                },
              }).catch(() => { /* tab gone */ });
              return;
            }
            if (resp?.draft) {
              chrome.tabs.sendMessage(tabId, {
                type: insertType,
                payload: { text: resp.draft },
              }).catch(() => { /* tab gone */ });
            }
          } catch (err) {
            console.warn('[SW] inline gmail generateDraft failed:', err);
            chrome.tabs.sendMessage(tabId, {
              type: 'DRAFT_SKIPPED',
              payload: { reason: 'error', message: 'Draft failed to generate. Try again.' },
            }).catch(() => { /* tab gone */ });
          }
        })();
        return { ok: true };
      }

      // Default path (non-gmail inline surfaces): open the side panel and let
      // the panel generate. Open FIRST, then broadcast after a delay so the
      // panel's message listener has time to initialize.
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
    // --- v0.7 Compose pop-over (Surface B) ---
    case 'GET_PROACTIVE_SUGGESTIONS': {
      try {
        const suggestions = await getProactiveSuggestions();
        return { suggestions };
      } catch (err) {
        console.warn('[Pranan SW] GET_PROACTIVE_SUGGESTIONS failed:', err);
        return { suggestions: [], error: (err as Error).message };
      }
    }

    case 'OPEN_THREAD': {
      const { threadId } = (message.payload as { threadId?: string }) || {};
      if (!threadId) return { ok: false };
      // Navigate the active tab to the thread URL hash. Gmail interprets
      // #inbox/<threadId> as "open this thread in current view."
      if (sender.tab?.id) {
        try {
          await chrome.tabs.update(sender.tab.id, { url: `https://mail.google.com/mail/u/0/#inbox/${threadId}` });
        } catch (err) {
          console.warn('[Pranan SW] OPEN_THREAD failed:', err);
        }
      }
      return { ok: true };
    }

    // --- v0.6 Inline composer: relationship chip + tone hints ---
    case 'SET_TIER_OVERRIDE': {
      const { email: overrideEmail, tier: overrideTier } = (message.payload as { email?: string; tier?: string }) || {};
      if (!overrideEmail || !overrideTier) return { ok: false };
      const result = await setTierOverride(overrideEmail, overrideTier);
      return result;
    }

    case 'GET_RELATIONSHIP_TIER': {
      const { email } = (message.payload as { email?: string }) || {};
      if (!email) return { tier: null };
      try {
        const ctx = await getCachedContactContext({ email });
        if (!ctx) return { tier: 'unknown', name: null };
        return {
          tier: ctx.tier || 'unknown',
          name: ctx.style?.contactName || null,
          tone: ctx.style?.tone || null,
        };
      } catch (err) {
        console.warn('[Pranan SW] GET_RELATIONSHIP_TIER failed:', err);
        return { tier: 'unknown', name: null };
      }
    }

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
      const refreshTokenFromWeb = (message as { refreshToken?: string }).refreshToken;
      await chrome.storage.local.set({
        authToken: token,
        ...(refreshTokenFromWeb ? { refreshToken: refreshTokenFromWeb } : {}),
      });

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

    case 'GET_REPLY_INTENTS': {
      try {
        const intents = await getReplyIntents((message as { payload?: Record<string, unknown> }).payload || {});
        return { intents };
      } catch {
        return { intents: [] };
      }
    }

    case 'DISCONNECT': {
      // Clear the extension's own session (Bearer + refresh tokens). Web
      // sign-out does not revoke this, so the user needs an explicit control.
      try { await chrome.storage.local.remove(['authToken', 'refreshToken']); } catch { /* pass */ }
      cachedAuth = null;
      broadcastToSidePanel({ type: 'AUTH_STATUS', payload: { valid: false } });
      return { ok: true };
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
    if (sender.origin !== APP_ORIGIN) {
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

// Re-init auth eagerly on service worker startup. The token refresh
// alarm is now scheduled inside scheduleTokenRefresh() (called by initAuth)
// using chrome.alarms.create with delayInMinutes: 25, then re-armed after
// each successful refresh. The previous duplicate 6-hour periodic alarm
// + listener block was removed because it ran the same logic with worse
// timing.
initAuth();



