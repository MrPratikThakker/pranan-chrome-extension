/**
 * Zustand Store for Pranan Companion
 *
 * Central state management. Persists critical state to chrome.storage
 * so it survives service worker restarts.
 */

import { create } from 'zustand';
import type {
  AppState,
  ViewMode,
  Platform,
  ComposeContext,
  ContactContext,
  DraftResponse,
  RewriteResponse,
  GrammarResponse,
  AuthResponse,
  ExtensionMessage,
} from '@/types';
import {
  validateAuth,
  getContactContext,
  generateDraft,
  streamDraft,
  rewriteText,
  checkGrammar,
  getBriefings,
  getNudges,
  getDecayAlerts,
  type DraftRequest,
  type RewriteRequest,
  type GrammarRequest,
} from '@/lib/api-client';
import type { MeetingBriefing, FollowUpNudge, DecayAlert } from '@/types';

// Active AbortControllers for cancellable requests
let draftAbortController: AbortController | null = null;
let rewriteAbortController: AbortController | null = null;
let grammarAbortController: AbortController | null = null;

interface Actions {
  // Auth
  setAuth: (user: AuthResponse | null, token?: string) => void;
  checkAuth: () => Promise<void>;
  hydrateAuthHint: () => Promise<void>;
  logout: () => void;

  // Context
  setPlatform: (platform: Platform) => void;
  setComposeContext: (ctx: ComposeContext | null) => void;
  loadContactContext: (email?: string, name?: string, linkedinUrl?: string) => Promise<void>;

  // Draft
  requestDraft: (request: DraftRequest) => Promise<void>;
  clearDraft: () => void;

  // Rewrite
  requestRewrite: (request: RewriteRequest) => Promise<void>;
  clearRewrite: () => void;

  // Grammar
  requestGrammar: (request: GrammarRequest) => Promise<void>;
  clearGrammar: () => void;

  // UI
  setViewMode: (mode: ViewMode) => void;
  setError: (error: string | null) => void;
  handleMessage: (message: ExtensionMessage) => void;

  // Intelligence (Phase 5)
  loadBriefings: () => Promise<void>;
  loadNudges: () => Promise<void>;
  loadDecayAlerts: () => Promise<void>;

  // Cancel
  cancelDraft: () => void;
  cancelRewrite: () => void;
  cancelGrammar: () => void;

  // Onboarding
  markOnboardingSeen: () => void;
  incrementInteraction: () => void;
}

const initialState: AppState = {
  isAuthenticated: false,
  isAuthChecked: false,
  lastKnownAuthValid: false,
  authToken: null,
  user: null,
  currentPlatform: 'unknown',
  composeContext: null,
  contactContext: null,
  contactContextLookup: null,
  currentDraft: null,
  isDraftLoading: false,
  isDraftStreaming: false,
  streamingDraftText: '',
  rewriteResult: null,
  isRewriteLoading: false,
  grammarResult: null,
  isGrammarLoading: false,
  viewMode: 'context',
  isLoading: false,
  error: null,
  briefings: [],
  nudges: [],
  decayAlerts: [],
  isBriefingLoading: false,
  isNudgesLoading: false,
  hasSeenOnboarding: false,
  interactionCount: 0,
};

export const useStore = create<AppState & Actions>((set, get) => ({
  ...initialState,

  // --- Auth ---

  setAuth: (user, token) => {
    const valid = !!user?.valid;
    set({
      isAuthenticated: valid,
      isAuthChecked: true,
      lastKnownAuthValid: valid,
      user,
      authToken: token || get().authToken,
      viewMode: valid ? 'context' : 'auth',
    });
    // Persist optimistic-render hint so the next cold open doesn't flicker.
    chrome.storage.local.set({ lastKnownAuthValid: valid }).catch(() => {});
  },

  checkAuth: async () => {
    // v0.4.0+: cookie-passthrough auth. We no longer copy/delete companion
    // token cookies. Every API call sends `credentials: 'include'`, so the
    // browser auto-attaches the user's Supabase auth cookie. Calling
    // validateAuth() is the single source of truth for "is the user signed
    // into app.pranan.ai right now?"
    //
    // Legacy stored Bearer tokens (pre-v0.4.0) still work via the Bearer
    // fallback in api-client.authedFetch(). They expire naturally and the
    // user transparently moves to cookie auth on the next call.
    try {
      const auth = await validateAuth();
      console.log('[Store] checkAuth: validateAuth result:', auth?.valid, auth?.userId);
      set({
        isAuthenticated: auth.valid,
        isAuthChecked: true,
        lastKnownAuthValid: auth.valid,
        user: auth,
        viewMode: auth.valid ? 'context' : 'auth',
      });
      chrome.storage.local.set({ lastKnownAuthValid: auth.valid }).catch(() => {});
    } catch (err) {
      console.error('[Store] checkAuth: failed:', err);
      // On failure DO NOT flip lastKnownAuthValid -- could be a transient
      // network blip and we'd rather hold the optimistic state until the
      // user explicitly logs out.
      set({ isAuthenticated: false, isAuthChecked: true, user: null, viewMode: 'auth' });
    }
  },

  // Hydrate lastKnownAuthValid from chrome.storage on first mount so the
  // initial paint can show the right shell instead of the auth screen.
  hydrateAuthHint: async () => {
    try {
      const v = await chrome.storage.local.get('lastKnownAuthValid');
      if (typeof v?.lastKnownAuthValid === 'boolean') {
        set({ lastKnownAuthValid: v.lastKnownAuthValid });
      }
    } catch {
      // chrome.storage may not be ready yet
    }
  },

  logout: () => {
    chrome.storage.local.remove(['authToken', 'lastKnownAuthValid']);
    set({
      isAuthenticated: false,
      isAuthChecked: true,
      lastKnownAuthValid: false,
      authToken: null,
      user: null,
      viewMode: 'auth',
    });
  },

  // --- Context ---

  setPlatform: (platform) => set({ currentPlatform: platform }),

  setComposeContext: (ctx) => {
    set({ composeContext: ctx });
    if (ctx) {
      // Auto-load contact context when compose is detected
      const email = ctx.recipientEmail;
      const name = ctx.recipientName;
      const linkedinUrl = (ctx as { linkedinUrl?: string | null }).linkedinUrl ?? null;
      if (email || name || linkedinUrl) {
        get().loadContactContext(
          email || undefined,
          name || undefined,
          linkedinUrl || undefined,
        );
      }
    } else {
      set({ contactContext: null, currentDraft: null });
    }
  },

  loadContactContext: async (email, name, linkedinUrl) => {
    if (!email && !name && !linkedinUrl) return;
    set({ isLoading: true, error: null, contactContextLookup: { email, name, linkedinUrl } });
    try {
      const context = await getContactContext({ email, name, linkedinUrl });
      set({ contactContext: context, isLoading: false, viewMode: 'context' });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load context',
      });
    }
  },

  // --- Draft ---

  requestDraft: async (request) => {
    // Abort any in-flight draft request
    draftAbortController?.abort();
    draftAbortController = new AbortController();
    const { signal } = draftAbortController;

    console.log('[Store] requestDraft: starting', { recipient: request.recipientEmail, platform: request.platform, hasTone: !!request.tone });

    // v0.4.0+: cookie-passthrough auth means there's no stored Bearer token
    // for most users. The legacy pre-flight check that errored on missing
    // authToken was producing false 'Not authenticated' banners for users
    // who are perfectly authed via cookie. Server-side authenticateCompanion
    // handles both paths; if neither works, the API returns 401 and
    // handleResponse in api-client clears state cleanly. No pre-flight needed.

    set({ isDraftLoading: true, isDraftStreaming: true, streamingDraftText: '', error: null, viewMode: 'draft', currentDraft: null });
    try {
      // Try streaming first; fall back to non-streaming
      let fullText = '';
      let meta: Partial<DraftResponse> = {};
      try {
        console.log('[Store] requestDraft: attempting SSE stream...');
        for await (const chunk of streamDraft(request, signal)) {
          if (chunk.type === 'chunk') {
            fullText += chunk.text;
            set({ streamingDraftText: fullText });
          } else if (chunk.type === 'done') {
            fullText = chunk.text || fullText;
            meta = chunk.meta || {};
          }
        }
        console.log('[Store] requestDraft: stream complete, text length:', fullText.length);
        const draft: DraftResponse = {
          draft: fullText,
          confidence: meta.confidence ?? 0,
          voiceMatch: meta.voiceMatch ?? 0,
          alternativeTones: meta.alternativeTones || [],
          // v0.8.1 — propagate skip metadata so the inline-bar auto-insert
          // path can short-circuit cleanly instead of leaving the bar stuck.
          skipped: (meta as { skipped?: boolean }).skipped,
          skipReason: (meta as { skipReason?: string }).skipReason,
          skipMessage: (meta as { skipMessage?: string }).skipMessage,
          ...meta,
        };
        set({ currentDraft: draft, isDraftLoading: false, isDraftStreaming: false, streamingDraftText: '' });
      } catch (streamErr) {
        // If streaming fails (not abort), fall back to non-streaming
        if (signal.aborted) throw streamErr;
        console.warn('[Store] requestDraft: stream failed, falling back to non-stream', streamErr instanceof Error ? streamErr.message : streamErr);
        const draft = await generateDraft(request, signal);
        console.log('[Store] requestDraft: non-stream complete, draft length:', draft.draft?.length);
        set({ currentDraft: draft, isDraftLoading: false, isDraftStreaming: false, streamingDraftText: '' });
      }
      get().incrementInteraction();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // Cancelled by user/new request
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate draft';
      console.error('[Store] requestDraft: FINAL ERROR', errorMsg, err);
      set({
        isDraftLoading: false,
        isDraftStreaming: false,
        streamingDraftText: '',
        viewMode: 'draft',
        currentDraft: null,
        error: errorMsg,
      });
    }
  },

  clearDraft: () => set({ currentDraft: null }),

  // --- Rewrite ---

  requestRewrite: async (request) => {
    rewriteAbortController?.abort();
    rewriteAbortController = new AbortController();
    const { signal } = rewriteAbortController;

    set({ isRewriteLoading: true, error: null, viewMode: 'rewrite' });
    try {
      const result = await rewriteText(request, signal);
      set({ rewriteResult: result, isRewriteLoading: false });
      get().incrementInteraction();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      set({
        isRewriteLoading: false,
        error: err instanceof Error ? err.message : 'Failed to rewrite',
      });
    }
  },

  clearRewrite: () => set({ rewriteResult: null }),

  // --- Grammar ---

  requestGrammar: async (request) => {
    grammarAbortController?.abort();
    grammarAbortController = new AbortController();
    const { signal } = grammarAbortController;

    set({ isGrammarLoading: true, error: null, viewMode: 'grammar' });
    try {
      const result = await checkGrammar(request, signal);
      set({ grammarResult: result, isGrammarLoading: false });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      set({
        isGrammarLoading: false,
        error: err instanceof Error ? err.message : 'Grammar check failed',
      });
    }
  },

  clearGrammar: () => set({ grammarResult: null }),

  // --- UI ---

  setViewMode: (mode) => set({ viewMode: mode }),

  setError: (error) => set({ error }),

  handleMessage: (message) => {
    switch (message.type) {
      case 'COMPOSE_DETECTED':
        get().setComposeContext(message.payload as ComposeContext);
        break;
      case 'COMPOSE_CLOSED':
        get().setComposeContext(null);
        break;
      case 'RECIPIENT_CHANGED': {
        const { recipientEmail } = message.payload as { recipientEmail: string };
        const current = get().composeContext;
        if (current) {
          get().setComposeContext({ ...current, recipientEmail });
        }
        break;
      }
      case 'TEXT_SELECTED': {
        const { selectedText } = message.payload as { selectedText: string };
        const ctx = get().composeContext;
        if (ctx) {
          set({ composeContext: { ...ctx, selectedText }, viewMode: 'rewrite' });
        }
        break;
      }
      case 'PLATFORM_DETECTED': {
        const { platform } = message.payload as { platform: Platform };
        get().setPlatform(platform);
        break;
      }
      // Phase 1: Inline requests from content scripts
      case 'INLINE_DRAFT_REQUEST': {
        const payload = message.payload as {
          platform?: string;
          recipientName?: string;
          recipientEmail?: string;
          channelName?: string;
          isDM?: boolean;
          messageToReplyTo?: string;
          currentText?: string;
          originSurface?: 'inline-bar' | 'sidepanel' | 'popover';
          composeType?: 'comment' | 'reply' | 'new';
        };
        // Set compose context and trigger draft
        const ctx: ComposeContext = {
          platform: (payload.platform || 'unknown') as Platform,
          recipientEmail: payload.recipientEmail || null,
          recipientName: payload.recipientName || null,
          threadId: null,
          messageToReplyTo: payload.messageToReplyTo || null,
          channelName: payload.channelName || null,
          isDM: payload.isDM || false,
          selectedText: null,
        };
        get().setComposeContext(ctx);
        // v0.7.3 — if the request came from the inline bar (Surface A),
        // auto-fire INSERT_DRAFT once generation completes. Previously the
        // user had to manually click "Draft reply" in the sidepanel after
        // hitting Generate inline, which made the inline bar feel broken.
        const autoInsert = payload.originSurface === 'inline-bar';
        const insertMessageType = payload.composeType === 'comment'
          ? 'INSERT_COMMENT_DRAFT'
          : 'INSERT_DRAFT';
        get().requestDraft({
          recipientEmail: payload.recipientEmail,
          recipientName: payload.recipientName,
          platform: payload.platform,
          channelName: payload.channelName,
          messageToReplyTo: payload.messageToReplyTo,
        }).then(() => {
          if (!autoInsert) return;
          const cur = get().currentDraft;
          // v0.8.1 — handle backend skip cleanly. Inline bar must reset its
          // loading state and surface the reason instead of hanging until
          // the 30s safety timer fires.
          if (cur?.skipped) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const tabId = tabs[0]?.id;
              if (!tabId) return;
              chrome.tabs.sendMessage(tabId, {
                type: 'DRAFT_SKIPPED',
                payload: {
                  reason: cur.skipReason || 'skipped',
                  message: cur.skipMessage || 'Draft skipped.',
                },
              }).catch(() => { /* tab navigated away or content script gone */ });
            });
            return;
          }
          const draft = cur?.draft;
          if (!draft) return;
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) return;
            chrome.tabs.sendMessage(tabId, {
              type: insertMessageType,
              payload: { text: draft },
            }).catch(() => { /* tab navigated away or content script gone */ });
          });
        }).catch(() => { /* requestDraft already logs + sets error state */ });
        break;
      }
      case 'INLINE_REWRITE_REQUEST': {
        const payload = message.payload as { text: string; platform?: string };
        const ctx = get().composeContext;
        if (ctx) {
          set({ composeContext: { ...ctx, selectedText: payload.text } });
        }
        get().requestRewrite({
          text: payload.text,
          platform: payload.platform,
        });
        break;
      }
      case 'INLINE_GRAMMAR_REQUEST': {
        const payload = message.payload as { text: string; platform?: string };
        const ctx = get().composeContext;
        if (ctx) {
          set({ composeContext: { ...ctx, selectedText: payload.text } });
        }
        get().requestGrammar({
          text: payload.text,
          platform: payload.platform,
        });
        break;
      }
      // Phase 6: LinkedIn comment draft request
      case 'COMMENT_DRAFT_REQUEST': {
        const payload = message.payload as {
          platform?: string;
          postAuthor?: string;
          postAuthorUrl?: string;
          postText?: string;
          postUrl?: string;
          prompt?: string;
          composeType?: string;
          originSurface?: 'inline-bar' | 'sidepanel' | 'popover';
        };
        const ctx: ComposeContext = {
          platform: (payload.platform || 'linkedin') as Platform,
          recipientEmail: null,
          recipientName: payload.postAuthor || null,
          threadId: null,
          messageToReplyTo: payload.postText || null,
          channelName: null,
          isDM: false,
          selectedText: null,
          composeType: 'comment',
          linkedinUrl: payload.postAuthorUrl || null,
        } as ComposeContext;
        get().setComposeContext(ctx);
        // v0.7.4 — same auto-insert pattern as INLINE_DRAFT_REQUEST.
        // If the LinkedIn comment bar fired this with originSurface='inline-bar',
        // auto-fire INSERT_COMMENT_DRAFT once the draft is generated.
        const autoInsert = payload.originSurface === 'inline-bar';
        get().requestDraft({
          recipientName: payload.postAuthor,
          platform: 'linkedin',
          messageToReplyTo: payload.postText,
          prompt: payload.prompt,
          composeType: 'comment',
          postUrl: payload.postUrl,
        }).then(() => {
          if (!autoInsert) return;
          const cur = get().currentDraft;
          if (cur?.skipped) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const tabId = tabs[0]?.id;
              if (!tabId) return;
              chrome.tabs.sendMessage(tabId, {
                type: 'DRAFT_SKIPPED',
                payload: {
                  reason: cur.skipReason || 'skipped',
                  message: cur.skipMessage || 'Draft skipped.',
                },
              }).catch(() => {});
            });
            return;
          }
          const draft = cur?.draft;
          if (!draft) return;
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) return;
            chrome.tabs.sendMessage(tabId, {
              type: 'INSERT_COMMENT_DRAFT',
              payload: { text: draft },
            }).catch(() => { /* tab navigated away or content script gone */ });
          });
        }).catch(() => { /* requestDraft already logs + sets error state */ });
        break;
      }
      // Phase 3: Grammar suggestions from inline monitor
      case 'GRAMMAR_SUGGESTIONS': {
        const payload = message.payload as { suggestions: unknown[] };
        // Could update a dedicated suggestions state here if needed
        break;
      }
      // Auto-context: user opened a thread (not composing, just reading)
      case 'THREAD_OPENED': {
        const payload = message.payload as {
          senderEmail?: string;
          senderName?: string;
          subject?: string;
          messagePreview?: string;
        };
        // Load relationship context for the sender so the side panel
        // shows it even without a compose window open
        if (payload.senderEmail || payload.senderName) {
          get().loadContactContext(
            payload.senderEmail || undefined,
            payload.senderName || undefined
          );
          // Switch to context view if we're on the empty state
          const current = get().viewMode;
          if (current !== 'draft' && current !== 'rewrite' && current !== 'grammar') {
            set({ viewMode: 'context' });
          }
        }
        break;
      }
      case 'AUTH_RECOVERED': {
        // SW saw a successful API call after a recent 401. Clear the
        // 'Not authenticated' error banner without forcing the user to
        // click Reconnect. The follow-up AUTH_STATUS broadcast (sent by
        // SW after re-validating) will refresh the user object.
        console.log('[Store] AUTH_RECOVERED received, clearing error banner');
        const current = get();
        if (current.error && /not authenticated|reconnect/i.test(current.error)) {
          set({ error: null });
        }
        // Also clear isAuthenticated=false if it was set by AUTH_EXPIRED;
        // the follow-up AUTH_STATUS valid will refill isAuthenticated=true.
        if (!current.isAuthenticated) {
          set({ isAuthenticated: true });
        }
        break;
      }
      case 'AUTH_STATUS': {
        console.log('[Store] AUTH_STATUS received:', message.payload);
        const payload = message.payload as { valid: boolean; user?: AuthResponse } | undefined;
        if (payload?.valid && payload.user) {
          console.log('[Store] Setting authenticated state for user:', payload.user.userId);
          get().setAuth(payload.user);
        } else if (payload?.valid) {
          // Valid but no user object -- re-check auth to get full user data
          console.log('[Store] AUTH_STATUS valid but no user, re-checking auth...');
          get().checkAuth();
        } else {
          console.log('[Store] AUTH_STATUS invalid, clearing auth');
          set({ isAuthenticated: false, user: null, viewMode: 'auth' });
        }
        break;
      }
    }
  },

  // --- Intelligence (Phase 5) ---

  loadBriefings: async () => {
    set({ isBriefingLoading: true });
    try {
      const briefings = await getBriefings();
      set({ briefings, isBriefingLoading: false });
    } catch {
      set({ isBriefingLoading: false });
    }
  },

  loadNudges: async () => {
    set({ isNudgesLoading: true });
    try {
      const nudges = await getNudges();
      set({ nudges, isNudgesLoading: false });
    } catch {
      set({ isNudgesLoading: false });
    }
  },

  loadDecayAlerts: async () => {
    try {
      const decayAlerts = await getDecayAlerts();
      set({ decayAlerts });
    } catch {
      // Silently fail
    }
  },

  // --- Cancel ---

  cancelDraft: () => {
    draftAbortController?.abort();
    draftAbortController = null;
    set({ isDraftLoading: false, isDraftStreaming: false, streamingDraftText: '' });
  },

  cancelRewrite: () => {
    rewriteAbortController?.abort();
    rewriteAbortController = null;
    set({ isRewriteLoading: false });
  },

  cancelGrammar: () => {
    grammarAbortController?.abort();
    grammarAbortController = null;
    set({ isGrammarLoading: false });
  },

  // --- Onboarding ---

  markOnboardingSeen: () => {
    set({ hasSeenOnboarding: true });
    chrome.storage.local.set({ hasSeenOnboarding: true });
  },

  incrementInteraction: () => {
    const count = get().interactionCount + 1;
    set({ interactionCount: count });
    chrome.storage.local.set({ interactionCount: count });
  },
}));




