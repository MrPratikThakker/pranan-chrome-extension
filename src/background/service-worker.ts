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
 * - API calls on behalf of content scripts (they never call the API or read
 *   tokens themselves; audit EXT-07, EXT-10)
 */

import {
  validateAuth,
  getContactContext,
  generateDraft,
  checkGrammar,
  getReplyIntents,
  setTierOverride,
  refreshAccessTokenWithOutcome,
  postVoiceExemplar,
  transcribeAudio,
  exchangeLoginNonce,
  setAuthExpiredHandler,
  type DraftRequest,
} from '@/lib/api-client';
import { draftErrorMessage } from '@/lib/draft-error-message';
import type { ExtensionMessage, Platform, AuthResponse, ContactContext } from '@/types';
import { bootstrapSentry } from '@/lib/observability';
import { APP_ORIGIN } from '@/lib/config';
import { usesDirectWorkerPath } from './inline-draft-routing';
import { clearAuthTokens, writeAuthTokens, restrictTokenStorageToTrustedContexts } from '@/lib/token-store';
import { getPrivacySettings } from '@/lib/privacy-settings';
import { beginCompanionLogin, consumePendingLogin, restorePendingLogin } from '@/lib/login-handoff';
import { base64ToBlob, safeAudioMimeType, MAX_AUDIO_BASE64_LENGTH } from '@/lib/audio-transfer';
import { isOwnContentScript, isTrustedPrivilegedSender, isValidTier } from './sender-trust';

// ---------------------------------------------------------------------------
// State (persisted via chrome.storage, rebuilt on service worker restart)
// ---------------------------------------------------------------------------


bootstrapSentry('service-worker');
void restrictTokenStorageToTrustedContexts();

let cachedAuth: AuthResponse | null = null;
const inlineRequests = new Map<string, AbortController>();

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
 * The worker wakes for every message, alarm and tab event. Validating on
 * every wake hit /api/companion/auth (which runs database counts) far more
 * often than needed (audit EXT-22). A confirmed-valid result is reused for a
 * few minutes across wakes; anything else is re-checked.
 */
const AUTH_CACHE_KEY = 'authCache';
const AUTH_CACHE_TTL_MS = 10 * 60 * 1000;

async function readAuthCache(): Promise<AuthResponse | null> {
  try {
    const stored = await chrome.storage.session.get(AUTH_CACHE_KEY);
    const entry = stored?.[AUTH_CACHE_KEY] as { auth?: AuthResponse; ts?: number } | undefined;
    if (!entry?.auth?.valid || typeof entry.ts !== 'number') return null;
    if ((entry.auth as { transient?: boolean }).transient) return null;
    if (Date.now() - entry.ts > AUTH_CACHE_TTL_MS) return null;
    return entry.auth;
  } catch {
    return null;
  }
}

async function writeAuthCache(auth: AuthResponse | null): Promise<void> {
  try {
    if (auth?.valid && !(auth as { transient?: boolean }).transient) {
      await chrome.storage.session.set({ [AUTH_CACHE_KEY]: { auth, ts: Date.now() } });
    } else {
      await chrome.storage.session.remove(AUTH_CACHE_KEY);
    }
  } catch { /* cache is an optimisation only */ }
}

async function invalidateAuthCache(): Promise<void> {
  try { await chrome.storage.session.remove(AUTH_CACHE_KEY); } catch { /* pass */ }
}

/**
 * Deduplicated validateAuth: if a validation is already in-flight,
 * return that promise instead of firing a parallel one.
 */
async function deduplicatedValidateAuth(): Promise<AuthResponse> {
  if (pendingValidation) return pendingValidation;
  pendingValidation = validateAuth()
    .then(async (auth) => { await writeAuthCache(auth); return auth; })
    .finally(() => {
      pendingValidation = null;
    });
  return pendingValidation;
}

async function initAuth(options: { allowCached?: boolean } = {}): Promise<boolean> {
  if (options.allowCached) {
    const cached = await readAuthCache();
    if (cached) {
      cachedAuth = cached;
      ensureRefreshAlarm();
      return true;
    }
  }
  try {
    cachedAuth = await deduplicatedValidateAuth();
    if (cachedAuth.valid) scheduleTokenRefresh();
    return cachedAuth.valid;
  } catch {
    cachedAuth = null;
    return false;
  }
}

/** Reset every piece of worker auth state and tell the side panel. */
async function markSignedOut(): Promise<void> {
  cachedAuth = null;
  await invalidateAuthCache();
  broadcastToSidePanel({ type: 'AUTH_STATUS', payload: { valid: false } });
}

// A 401 seen by the worker's own API calls lands here (audit EXT-24).
setAuthExpiredHandler(() => { void markSignedOut(); });

function ensureRefreshAlarm() {
  try {
    chrome.alarms.get(REFRESH_ALARM_NAME, (alarm) => {
      if (!alarm) scheduleTokenRefresh();
    });
  } catch { /* alarms unavailable */ }
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
      await clearAuthTokens();
      await markSignedOut();
    }
  } catch {
    // Transient failure (network blip, server waking, laptop resuming). Do NOT
    // let the refresh cycle die: re-arm so we retry on the next interval
    // instead of silently stopping until a cold SW start (token-refresh
    // hardening 2026-06-09).
    scheduleTokenRefresh();
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

async function getCachedContactContext(params: { email?: string; name?: string; mailboxEmail?: string }): Promise<ContactContext | null> {
  if (!params.email && !params.name) return null;
  const key = JSON.stringify([cachedAuth?.userId, params.mailboxEmail, params.email || params.name]);

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
      broadcastToSidePanel({ ...message, payload: { ...(message.payload && typeof message.payload === "object" ? message.payload : {}), sourceTabId: sender.tab?.id } });
      return { ok: true };

    // Centralized token refresh: the SW is the SOLE refresher so the single-use
    // rotating refresh token is never consumed by two racing contexts. Other
    // contexts send REFRESH_TOKEN; refreshAccessToken() dedups via refreshInFlight
    // and persists the new token to storage for the caller to re-read.
    case 'REFRESH_TOKEN': {
      // The outcome lets the caller tell a dead refresh token (sign in again)
      // from a rate limit or server blip (keep the session, retry later).
      const { outcome } = await refreshAccessTokenWithOutcome();
      return { ok: outcome === 'refreshed', outcome };
    }

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
      if (!isTrustedPrivilegedSender(sender)) return { ok: false };
      await clearAuthTokens();
      await markSignedOut();
      try {
        if (chrome.action && 'openPopup' in chrome.action) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (chrome.action as any).openPopup();
        }
      } catch { /* pass — openPopup unavailable on some platforms */ }
      return { ok: true };
    }

    case 'SIDE_PANEL_READY': {
      // The panel runs its own checkAuth; a recent confirmed result is enough here.
      const isAuthed = await initAuth({ allowCached: true });
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
    case 'CANCEL_INLINE_DRAFT': {
      const id = (message.payload as { requestId?: string })?.requestId;
      if (id && sender.tab?.id) inlineRequests.get(`${sender.tab.id}:${id}`)?.abort();
      return { ok: true };
    }
    case 'INLINE_DRAFT_REQUEST': {
      const tab = sender.tab;
      const inlinePayload = message.payload as {
        requestId?: string;
        mailboxEmail?: string;
        tone?: string;
        platform?: string;
        recipientEmail?: string;
        recipientName?: string;
        channelName?: string;
        messageToReplyTo?: string;
        currentDraft?: string;
        currentText?: string;
        userPrompt?: string;
        prompt?: string;
        isDM?: boolean;
        originSurface?: 'inline-bar' | 'compose-toolbar' | 'sidepanel' | 'popover';
        composeType?: 'comment' | 'reply' | 'new';
        editorId?: string;
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
      // v0.8.22 (audit P1) — Slack now uses this SAME direct-worker path.
      // Previously Slack inline fell through to the side-panel handoff below,
      // which silently produced nothing when the panel was closed while the
      // content script optimistically cleared the prompt.
      //
      // That note used to end "Gmail and LinkedIn were already migrated; Slack
      // was the straggler." LinkedIn was never in the list. Measured on live
      // LinkedIn messaging on v0.8.48: pressed Generate, and twenty-six seconds
      // later the button still read "Generate", the compose was empty and no
      // error had been shown -- the exact failure the comment described, still
      // live for the surface the comment said was fixed.
      //
      // LinkedIn comments were unaffected because they travel as
      // COMMENT_DRAFT_REQUEST, whose gate has no platform restriction, which is
      // why commenting worked in the same session messaging did not.
      //
      // The list lives in inline-draft-routing.ts with a test that pins all
      // three surfaces.
      if (usesDirectWorkerPath(inlinePayload) && tab?.id) {
        runDirectDraft({
          tabId: tab.id,
          originUrl: tab.url,
          requestId: inlinePayload.requestId,
          editorId: inlinePayload.editorId,
          insertType: inlinePayload.composeType === 'comment' ? 'INSERT_COMMENT_DRAFT' : 'INSERT_DRAFT',
          emptyMessage: "Pranan couldn't draft a reply for this one. Try again, or type a prompt and press Generate.",
          label: 'inline',
          request: {
            recipientEmail: inlinePayload.recipientEmail || undefined,
            recipientName: inlinePayload.recipientName || undefined,
            messageToReplyTo: inlinePayload.messageToReplyTo || undefined,
            // Slack's Send-adjacent button sends what the user already typed
            // as currentText. It was dropped here, so the draft never saw it
            // (audit EXT-12).
            currentDraft: inlinePayload.currentDraft || inlinePayload.currentText || undefined,
            mailboxEmail: inlinePayload.mailboxEmail,
            tone: inlinePayload.tone,
            platform: inlinePayload.platform,
            channelName: inlinePayload.channelName || undefined,
            prompt: inlinePayload.userPrompt || inlinePayload.prompt || undefined,
          },
        });
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
      const commentPayload = (message.payload || {}) as {
        platform?: string;
        postAuthor?: string;
        postAuthorUrl?: string;
        postText?: string;
        postUrl?: string;
        prompt?: string;
        composeType?: 'comment' | 'reply' | 'new';
        originSurface?: string;
        editorId?: string;
        requestId?: string;
      };

      // v0.8.17 (QA 2026-06-12) — generate the comment HERE in the service
      // worker and insert it directly into the LinkedIn comment box, exactly
      // like the Gmail inline-bar path above. The previous flow only routed
      // through the side panel (open panel -> COMMENT_DRAFT_REQUEST broadcast
      // -> panel generates -> INSERT_COMMENT_DRAFT). That depended on
      // chrome.sidePanel.open() succeeding from the worker after the
      // content-script gesture hop (unreliable) AND the panel being mounted.
      // With the panel closed, clicking Draft produced NOTHING (no output,
      // no error). Generating in the worker removes both dependencies.
      if (commentPayload.originSurface === 'inline-bar' && tab?.id) {
        // Same bounded, correlated path as inline drafts. This one used to
        // have no deadline, so a stalled request could land a stale comment
        // in an editor the user had since typed in (audit EXT-16).
        runDirectDraft({
          tabId: tab.id,
          originUrl: tab.url,
          requestId: commentPayload.requestId,
          editorId: commentPayload.editorId,
          insertType: 'INSERT_COMMENT_DRAFT',
          emptyMessage: "Pranan couldn't draft a comment for this one. Try again, or type a prompt and press Generate.",
          label: 'linkedin comment',
          request: {
            recipientName: commentPayload.postAuthor || undefined,
            messageToReplyTo: commentPayload.postText || undefined,
            platform: commentPayload.platform || 'linkedin',
            prompt: commentPayload.prompt || undefined,
            composeType: 'comment',
            postUrl: commentPayload.postUrl || undefined,
            postAuthorUrl: commentPayload.postAuthorUrl || undefined,
          },
        });
        return { ok: true };
      }

      // Fallback (non inline-bar surfaces): open the side panel and let the
      // panel generate, as before.
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
    // Opt-in only (audit EXT-02 / XP-05). The content script checks the same
    // switch, but the worker is the one that talks to the API, so it enforces
    // it: with the switch off, nothing the user typed leaves the browser.
    case 'INLINE_GRAMMAR_CHECK': {
      const { text, platform, recipientEmail } = (message.payload as { text?: string; platform?: string; recipientEmail?: string | null }) || {};
      if (!text || typeof text !== 'string') return { suggestions: [] };
      const { passiveGrammarChecks } = await getPrivacySettings();
      if (!passiveGrammarChecks) return { suggestions: [], disabled: true };
      try {
        const result = await checkGrammar({
          text,
          platform,
          recipientEmail: typeof recipientEmail === 'string' && recipientEmail ? recipientEmail : undefined,
        });
        // Convert grammar corrections to InlineSuggestion format
        const suggestions = (result.corrections || []).map((c, i) => ({
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
    // Rendered by the side panel's "Writing suggestions" card.
    case 'GRAMMAR_SUGGESTIONS': {
      broadcastToSidePanel({
        ...message,
        payload: { ...(message.payload && typeof message.payload === 'object' ? message.payload : {}), sourceTabId: sender.tab?.id },
      });
      return { ok: true };
    }

    // --- Voice input on behalf of content scripts (audit EXT-07) ---
    case 'TRANSCRIBE_AUDIO': {
      if (!sender.tab) return { error: 'Voice transcription is only available from a compose window.' };
      const { audio, mimeType } = (message.payload as { audio?: unknown; mimeType?: unknown }) || {};
      if (typeof audio !== 'string' || !audio || audio.length > MAX_AUDIO_BASE64_LENGTH) {
        return { error: 'No speech was recorded. Try again or keep typing.' };
      }
      try {
        const text = await transcribeAudio(base64ToBlob(audio, safeAudioMimeType(mimeType)));
        return { text };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Voice transcription failed. Try again.' };
      }
    }

    // --- LinkedIn voice samples ---
    case 'CAPTURE_VOICE_EXEMPLAR': {
      // From the LinkedIn content script after the user's own comment has
      // actually been posted. Off unless the user opted in (audit EXT-03), and
      // only accepted from our own LinkedIn content script.
      if (!isOwnContentScript(sender, 'https://www.linkedin.com')) return { added: false };
      const { linkedinVoiceCapture } = await getPrivacySettings();
      if (!linkedinVoiceCapture) return { added: false, disabled: true };
      const captured = (message.payload as { comment?: string } | undefined)?.comment;
      if (!captured || typeof captured !== 'string' || captured.length > 600) return { added: false };
      return postVoiceExemplar(captured);
    }
    case 'SET_TIER_OVERRIDE': {
      // The tier pill in Gmail's compose bar is the only sender. It used to be
      // rejected here as "untrusted", so the correction always failed silently
      // (audit EXT-17 / XP-12). Allow this extension's own Gmail content script
      // and the extension pages, and validate both fields.
      const fromGmail = isOwnContentScript(sender, 'https://mail.google.com');
      if (!fromGmail && !isTrustedPrivilegedSender(sender)) {
        console.warn('[SW] SET_TIER_OVERRIDE rejected: untrusted sender', sender.origin || sender.url);
        return { ok: false };
      }
      const { email: overrideEmail, tier: overrideTier } = (message.payload as { email?: unknown; tier?: unknown }) || {};
      if (typeof overrideEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideEmail) || overrideEmail.length > 320) return { ok: false };
      if (!isValidTier(overrideTier)) return { ok: false };
      return setTierOverride(overrideEmail, overrideTier);
    }

    case 'GET_RELATIONSHIP_TIER': {
      const { email, mailboxEmail } = (message.payload as { email?: string; mailboxEmail?: string }) || {};
      if (!email) return { tier: null };
      try {
        const ctx = await getCachedContactContext({ email, mailboxEmail });
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
      if (!isTrustedPrivilegedSender(sender)) {
        console.warn('[SW] AUTH_TOKEN_FROM_WEB rejected: untrusted sender', sender.origin || sender.url);
        return { error: 'Untrusted sender' };
      }
      const handoff = message as { token?: unknown; refreshToken?: unknown; nonce?: unknown; state?: unknown };
      return acceptWebAuthHandoff(handoff);
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
      // The caller revokes the server session first (audit EXT-23).
      if (!isTrustedPrivilegedSender(sender)) return { ok: false };
      await clearAuthTokens();
      await markSignedOut();
      return { ok: true };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

/**
 * Generate a draft in the worker and send it straight to the requesting tab.
 *
 * Bounded, and bounded BELOW the content scripts' own 30s reset. Nothing else
 * in this path has a deadline: generateDraft awaits ensureValidToken (which
 * can await a token refresh) and then the fetch. If any of that hangs, the
 * content script hears nothing at all and falls through to its own timeout,
 * whose copy tells the user to check they are signed in. Observed on Pratik's
 * inbox 29 Jul with a valid session and a healthy API. 25s leaves the bar
 * time to render a real reason instead.
 *
 * Every reply carries the request's originUrl, editorId and requestId so the
 * content script inserts only into the editor that asked, and only while that
 * request is still the live one.
 */
function runDirectDraft(args: {
  tabId: number;
  originUrl?: string;
  requestId?: string;
  editorId?: string;
  insertType: 'INSERT_DRAFT' | 'INSERT_COMMENT_DRAFT';
  emptyMessage: string;
  label: string;
  request: DraftRequest;
}): void {
  const { tabId, insertType } = args;
  const requestKey = `${tabId}:${args.requestId || crypto.randomUUID()}`;
  inlineRequests.get(requestKey)?.abort();
  const controller = new AbortController();
  inlineRequests.set(requestKey, controller);
  const deadline = setTimeout(() => controller.abort(new DOMException('Draft timed out', 'TimeoutError')), 25_000);
  const correlation = { originUrl: args.originUrl, editorId: args.editorId, requestId: args.requestId };
  const reply = (message: { type: string; payload: Record<string, unknown> }) => {
    chrome.tabs.sendMessage(tabId, message).catch(() => { /* tab gone */ });
  };
  (async () => {
    try {
      const resp = await generateDraft(args.request, controller.signal);
      if (controller.signal.aborted) return;
      if (resp?.skipped) {
        reply({
          type: 'DRAFT_SKIPPED',
          payload: { ...correlation, reason: resp.skipReason || 'skipped', message: resp.skipMessage || 'Draft skipped.' },
        });
        return;
      }
      if (resp?.draft) {
        reply({ type: insertType, payload: { text: resp.draft, ...correlation } });
        return;
      }
      // Response came back OK but carried neither a draft nor a skip flag
      // (empty draft or unexpected shape). Do NOT leave the bar hanging to a
      // silent 30s reset; surface it so Generate fails loudly.
      console.warn(`[SW] ${args.label}: empty draft response`, resp);
      reply({ type: 'DRAFT_SKIPPED', payload: { ...correlation, reason: 'empty', message: args.emptyMessage } });
    } catch (err) {
      console.warn(`[SW] ${args.label} generateDraft failed:`, err);
      // A user cancel is not an error worth showing; a timeout is.
      const cancelled = controller.signal.aborted
        && !(controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError');
      if (cancelled) return;
      const reason = controller.signal.aborted ? controller.signal.reason : err;
      reply({ type: 'DRAFT_SKIPPED', payload: { ...correlation, reason: 'error', message: draftErrorMessage(reason) } });
    } finally {
      clearTimeout(deadline);
      if (inlineRequests.get(requestKey) === controller) inlineRequests.delete(requestKey);
    }
  })();
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
    // Without the "tabs" permission (audit EXT-14) tab.url is only visible on
    // the sites we have host access to, which are exactly the supported ones.
    // Anything else reads as 'unknown', which is the right answer.
    const platform = detectPlatform(tab.url || '');
    broadcastToSidePanel({
      type: 'PLATFORM_DETECTED',
      payload: { platform, tabId: activeInfo.tabId },
    });
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
// Sign-in handoff from app.pranan.ai
// ---------------------------------------------------------------------------

/**
 * Store tokens handed over by the web app, but only for a sign-in the
 * extension itself started (audit EXT-09, see login-handoff.ts). Accepts
 * either the tokens (today's app) or the one-time nonce, which the worker
 * exchanges itself so the tokens never pass through page script.
 */
async function acceptWebAuthHandoff(input: {
  token?: unknown;
  refreshToken?: unknown;
  nonce?: unknown;
  state?: unknown;
}, options: { requireRefreshToken?: boolean } = {}): Promise<{ ok: true } | { error: string }> {
  const nonce = typeof input.nonce === 'string' && /^[a-f0-9]{64}$/i.test(input.nonce) ? input.nonce : null;
  const suppliedToken = typeof input.token === 'string' && input.token ? input.token : null;
  const suppliedRefresh = typeof input.refreshToken === 'string' && input.refreshToken ? input.refreshToken : null;
  if (!nonce && !suppliedToken) return { error: 'No token provided' };
  if (!nonce && options.requireRefreshToken && !suppliedRefresh) return { error: 'Refresh token required' };

  const check = await consumePendingLogin(input.state);
  if (!check.ok) {
    console.warn('[SW] sign-in handoff rejected:', check.reason);
    return { error: 'No sign-in was started from the extension. Click Connect in Pranan and try again.' };
  }

  let tokens: { authToken: string; refreshToken: string | null };
  if (nonce) {
    const exchanged = await exchangeLoginNonce(nonce);
    if (!exchanged) {
      await restorePendingLogin(check.pending);
      return { error: 'Sign-in link expired. Click Connect in Pranan and try again.' };
    }
    tokens = { authToken: exchanged.token, refreshToken: exchanged.refreshToken };
  } else {
    tokens = { authToken: suppliedToken as string, refreshToken: suppliedRefresh };
  }

  // Audit (LOW): every auth write replaces BOTH tokens, so a re-auth never
  // leaves a refresh token from an earlier session behind.
  await writeAuthTokens(tokens);
  await invalidateAuthCache();

  try {
    cachedAuth = await deduplicatedValidateAuth();
  } catch (err) {
    console.error('[SW] validateAuth failed:', err);
    // Validation failed: clear BOTH tokens so we never keep a half-valid pair.
    await clearAuthTokens();
    await markSignedOut();
    await restorePendingLogin(check.pending);
    return { error: 'Token validation failed' };
  }

  if (cachedAuth?.valid) {
    scheduleTokenRefresh();
    broadcastToSidePanel({ type: 'AUTH_STATUS', payload: { valid: true, user: cachedAuth } });
    return { ok: true };
  }
  await clearAuthTokens();
  await markSignedOut();
  await restorePendingLogin(check.pending);
  return { error: 'Token invalid' };
}

// ---------------------------------------------------------------------------
// External Messages (from app.pranan.ai)
// ---------------------------------------------------------------------------

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (sender.origin !== APP_ORIGIN) {
      sendResponse({ error: 'Unauthorized origin' });
      return false;
    }
    const type = message && typeof message === 'object' ? (message as { type?: unknown }).type : undefined;

    if (type === 'PING') {
      // Lets app.pranan.ai detect the extension (onboarding extension slide
      // and the /home pairing card, audit 2026-07-17). `authenticated` lets
      // the app offer "Connect" when the extension is installed but not
      // signed in (XP-15). Synchronous response.
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version, authenticated: !!cachedAuth?.valid });
      return false;
    }

    if (type === 'AUTH_TOKEN') {
      // Same rules as the content-script handoff, plus: a refresh token is
      // required. Accepting an access token alone used to clear the stored
      // refresh token and cut the session to about an hour (audit EXT-19).
      acceptWebAuthHandoff(message as Record<string, unknown>, { requireRefreshToken: true })
        .then(sendResponse)
        .catch(() => sendResponse({ error: 'Sign-in failed' }));
      return true; // async response
    }

    // Every message gets an answer, so the app's callback never hangs.
    sendResponse({ error: 'Unknown message type' });
    return false;
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

// On browser startup, proactively validate + refresh and re-arm the refresh
// alarm. Without this, after a Chrome restart the token can sit expired until a
// user action pokes it, which looks like a silent logout (token-refresh
// hardening 2026-06-09).
chrome.runtime.onStartup.addListener(() => {
  void initAuth();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ hasSeenOnboarding: false, interactionCount: 0 });

    // First-run was previously silent: a Chrome Web Store install produced
    // nothing visible until the user happened to find the toolbar icon
    // (audit 2026-07-17 P1-3). Open the app's companion sign-in so every
    // install lands somewhere. It used to open /login?source=extension_install,
    // which the app does not treat as a companion sign-in, so signed-in users
    // landed on /home with the extension still unpaired (XP-15). The companion
    // source runs the normal handoff, and beginCompanionLogin records the
    // pending login the worker requires (EXT-09).
    try {
      await beginCompanionLogin();
    } catch {
      // Tab creation can fail during browser startup/session restore; the
      // extension still works, the user just gets the old silent behavior.
    }
  }

  // Enable side panel on all supported sites
  await chrome.sidePanel.setOptions({
    enabled: true,
  });
});

// Re-init auth on service worker startup. The worker wakes for every message
// and event, so a recent confirmed result is reused instead of hitting
// /api/companion/auth each time (audit EXT-22). The token refresh alarm is
// scheduled inside scheduleTokenRefresh() (called by initAuth) and re-armed
// after each successful refresh.
void initAuth({ allowCached: true });

