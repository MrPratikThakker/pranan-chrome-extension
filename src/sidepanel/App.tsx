/**
 * Pranan Companion -- Side Panel App
 *
 * Main orchestration component. Renders the correct panel based on
 * auth state, compose detection, and user-selected view mode.
 * Listens for messages from content scripts via chrome.runtime.
 */

import React, { useEffect, useCallback, useState, Component, type ReactNode, type ErrorInfo } from 'react';
import { useStore } from '@/hooks/useStore';
import { AuthPanel } from '@/components/AuthPanel';
import { EmptyState } from '@/components/EmptyState';
import { ContactCard } from '@/components/ContactCard';
import { DraftPanel } from '@/components/DraftPanel';
import { sendInsertToActiveTab } from '@/lib/insert-ack';
import { RewritePanel } from '@/components/RewritePanel';
import { GrammarPanel } from '@/components/GrammarPanel';
import { BriefingPanel } from '@/components/BriefingPanel';
import { NudgesPanel } from '@/components/NudgesPanel';
import { SnippetsPanel } from '@/components/SnippetsPanel';
import { SessionsPanel } from '@/components/SessionsPanel';
import { VoicePromptField } from '@/components/VoicePromptField';
import { dismissNudge, draftFromNudge } from '@/lib/api-client';
import type { ExtensionMessage, Platform, MeetingBriefing } from '@/types';
import { APP_ORIGIN, appUrl } from '@/lib/config';

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Pranan] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-brand-bg text-brand-text p-6">
          <div className="w-12 h-12 rounded-lg bg-brand-red/10 border border-brand-red/20 flex items-center justify-center mb-3">
            <span className="text-brand-red text-xl">!</span>
          </div>
          <h2 className="text-sm font-semibold mb-1">Something went wrong</h2>
          <p className="text-xs text-brand-text-3 text-center mb-4">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn-accent text-xs py-2 px-4"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const API_BASE = APP_ORIGIN;

function AppInner() {
  const {
    isAuthenticated,
    isAuthChecked,
    lastKnownAuthValid,
    user,
    currentPlatform,
    composeContext,
    contactContext,
    contactContextLookup,
    currentDraft,
    isDraftLoading,
    isDraftStreaming,
    streamingDraftText,
    rewriteResult,
    isRewriteLoading,
    grammarResult,
    isGrammarLoading,
    viewMode,
    isLoading,
    error,
    checkAuth,
    setAuth,
    logout,
    handleMessage,
    setViewMode,
    setError,
    requestDraft,
    requestRewrite,
    requestGrammar,
    clearDraft,
    clearRewrite,
    clearGrammar,
    setPlatform,
    briefings,
    nudges,
    decayAlerts,
    isBriefingLoading,
    isNudgesLoading,
    loadBriefings,
    loadNudges,
    loadDecayAlerts,
  } = useStore();

  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickTone, setQuickTone] = useState('');
  useEffect(() => { setQuickPrompt(''); }, [composeContext?.sourceTabId, composeContext?.editorId, composeContext?.recipientEmail, composeContext?.threadId]);

  // --- Lifecycle ---

  // Load intelligence data when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadBriefings();
      loadNudges();
      loadDecayAlerts();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    // Check auth on mount
    checkAuth();

    // Restore onboarding state
    chrome.storage.local.get(['hasSeenOnboarding', 'interactionCount'], (result) => {
      if (result.hasSeenOnboarding) {
        useStore.setState({ hasSeenOnboarding: true });
      }
      if (result.interactionCount) {
        useStore.setState({ interactionCount: result.interactionCount });
      }
    });

    // Get current tab platform
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        const url = tabs[0].url;
        let platform: Platform = 'unknown';
        if (url.includes('mail.google.com')) platform = 'gmail';
        else if (url.includes('app.slack.com')) platform = 'slack';
        else if (url.includes('linkedin.com')) platform = 'linkedin';
        setPlatform(platform);
      }
    });
  }, []);

  // --- Message Listener ---

  useEffect(() => {
    const listener = (
      message: ExtensionMessage & { _fromSW?: boolean },
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void
    ): undefined => {
      // Only handle messages broadcast by the service worker (tagged with _fromSW)
      // to avoid processing content script messages meant for the SW
      if (!message._fromSW) return;
      if (import.meta.env.DEV) console.log('[SidePanel] Received message:', message.type);
      handleMessage(message);
      // Return undefined (not true) -- we don't call sendResponse, so Chrome
      // should not keep the message channel open.
      return undefined;
    };

    chrome.runtime.onMessage.addListener(listener);

    // Notify background that side panel is ready
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_READY' }).catch(() => {
      // Background may not be listening yet, that's fine
    });

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [handleMessage]);

  // --- Handlers ---

  const handleConnect = useCallback(() => {
    if (import.meta.env.DEV) console.log('[Pranan] Connect clicked, opening login...');
    chrome.tabs.create({ url: `${API_BASE}/login?source=companion` })
      .then((tab) => { if (import.meta.env.DEV) console.log('[Pranan] Tab created:', tab?.id); })
      .catch((err) => console.error('[Pranan] Failed to create tab:', err));
  }, []);

  const handleGenerateDraft = useCallback(() => {
    if (import.meta.env.DEV) console.log('[SidePanel] Draft clicked, composeContext:', composeContext ? 'set' : 'null');
    if (!composeContext) {
      setError('No compose window detected. Open a compose or reply in Gmail, then try again.');
      return;
    }
    if (import.meta.env.DEV) console.log('[SidePanel] Requesting draft for:', composeContext.recipientEmail, 'platform:', composeContext.platform);
    requestDraft({
      recipientEmail: composeContext.recipientEmail || undefined,
      recipientName: composeContext.recipientName || undefined,
      threadId: composeContext.threadId || undefined,
      messageToReplyTo: composeContext.messageToReplyTo || undefined,
      platform: composeContext.platform,
      composeType: composeContext.composeType,
      channelName: composeContext.channelName || undefined,
      prompt: quickPrompt || undefined,
      tone: quickTone || undefined,
    });
  }, [composeContext, quickPrompt, quickTone, requestDraft, setError]);

  const handleRewrite = useCallback(() => {
    if (!composeContext?.selectedText) return;
    requestRewrite({
      text: composeContext.selectedText,
      recipientEmail: composeContext.recipientEmail || undefined,
      platform: composeContext.platform,
    });
  }, [composeContext, requestRewrite]);

  const handleGrammarCheck = useCallback(() => {
    if (!composeContext?.selectedText) return;
    requestGrammar({
      text: composeContext.selectedText,
      recipientEmail: composeContext.recipientEmail || undefined,
      platform: composeContext.platform,
    });
  }, [composeContext, requestGrammar]);

  const handleInsertDraft = useCallback((text: string, onResult?: (ok: boolean) => void) => {
    // Send to content script to inject into compose window.
    // Use INSERT_COMMENT_DRAFT for LinkedIn comment drafts.
    // Audit (MEDIUM/LOW): this used to be fire-and-forget. sendInsertToActiveTab
    // reads the content script's sendResponse({ success }) and
    // chrome.runtime.lastError so the panel can show Inserted / Could not
    // insert (with copy fallback).
    const messageType = composeContext?.composeType === 'comment' ? 'INSERT_COMMENT_DRAFT' : 'INSERT_DRAFT';
    sendInsertToActiveTab(messageType, text, composeContext || undefined).then((ok) => onResult?.(ok));
  }, [composeContext]);

  const handleRegenerateDraft = useCallback((tone?: string) => {
    requestDraft({
      recipientEmail: composeContext?.recipientEmail || undefined,
      recipientName: composeContext?.recipientName || undefined,
      threadId: composeContext?.threadId || undefined,
      messageToReplyTo: composeContext?.messageToReplyTo || undefined,
      platform: composeContext?.platform || 'gmail',
      composeType: composeContext?.composeType,
      prompt: quickPrompt || undefined,
      tone,
    });
  }, [composeContext, quickPrompt, requestDraft]);

  const handleAcceptRewrite = useCallback((text: string) => {
    handleInsertDraft(text);
    clearRewrite();
    setViewMode('context');
  }, [handleInsertDraft, clearRewrite, setViewMode]);

  const handleDismissNudge = useCallback(async (nudgeId: string) => {
    try {
      await dismissNudge(nudgeId);
    } catch {
      // Silent -- optimistic UI already removed it
    }
  }, []);

  const handleDraftFromNudge = useCallback(async (nudgeId: string) => {
    try {
      const draft = await draftFromNudge(nudgeId);
      useStore.setState({ currentDraft: draft, viewMode: 'draft' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate draft');
    }
  }, [setError]);

  const handleDraftFromBriefing = useCallback((briefing: MeetingBriefing) => {
    const attendeeNames = briefing.attendees.map(a => a.name).join(', ');
    requestDraft({
      recipientName: attendeeNames,
      prompt: `Pre-meeting prep email for "${briefing.meetingTitle}". Talking points: ${briefing.talkingPoints.join('; ')}`,
      platform: 'gmail',
    });
  }, [requestDraft]);

  // --- Keyboard Shortcuts ---

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Escape: go back to context view
      if (e.key === 'Escape') {
        e.preventDefault();
        if (viewMode !== 'context' && viewMode !== 'auth') {
          clearDraft();
          clearRewrite();
          clearGrammar();
          setViewMode('context');
        }
        return;
      }

      if (!mod || !e.shiftKey) return;

      switch (e.key.toLowerCase()) {
        case 'd': // Cmd+Shift+D: Generate draft
          e.preventDefault();
          if (composeContext) handleGenerateDraft();
          break;
        case 'r': // Cmd+Shift+R: Rewrite selection
          e.preventDefault();
          if (composeContext?.selectedText) handleRewrite();
          break;
        case 'g': // Cmd+Shift+G: Grammar check
          e.preventDefault();
          if (composeContext?.selectedText) handleGrammarCheck();
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [viewMode, composeContext, handleGenerateDraft, handleRewrite, handleGrammarCheck, clearDraft, clearRewrite, clearGrammar, setViewMode]);

  // --- Render ---

  // Auth gate.
  //
  // On cold open, validateAuth takes ~500ms. During that window,
  // isAuthenticated is false but isAuthChecked is also false. Showing
  // the AuthPanel during that window is the flicker users complained
  // about. We defer to the persisted lastKnownAuthValid hint and only
  // hard-render the unauth screen once the first check has actually
  // resolved unauthenticated.
  // Auth gate fix (v0.5.2): always show Loading until isAuthChecked
  // resolves. Previously the gate fell through to AuthPanel when
  // lastKnownAuthValid was false, but lastKnownAuthValid is hydrated
  // asynchronously from chrome.storage and starts false on every
  // fresh component mount, so first paint always rendered AuthPanel
  // for ~500ms before checkAuth() finished. That was the flicker.
  if (!isAuthChecked) {
    return (
      <div className="h-screen flex items-center justify-center bg-brand-bg text-brand-text">
        <div className="text-xs text-brand-text-3 animate-pulse">Loading...</div>
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <div className="h-screen flex flex-col bg-brand-bg text-brand-text">
        <AuthPanel onConnect={handleConnect} />
      </div>
    );
  }

  const isReplyCompose = !!composeContext?.messageToReplyTo;
  const composeActionLabel = isReplyCompose ? 'Draft reply' : 'Draft email';
  const composePromptPlaceholder = isReplyCompose
    ? 'Describe the reply, or leave blank to use the conversation'
    : 'Describe this email';
  const recipientLabel = composeContext?.recipientName || composeContext?.recipientEmail;

  return (
    <div className="h-screen flex flex-col bg-brand-bg text-brand-text">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-brand-border bg-brand-bg flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-brand-accent/10 border border-brand-accent/15 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="sidepanelBrandGrad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#4c1d95" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="33" stroke="url(#sidepanelBrandGrad)" strokeWidth="7" fill="none" />
            <circle cx="60" cy="60" r="16" fill="url(#sidepanelBrandGrad)" />
          </svg>
          </div>
          <span className="text-sm font-light text-brand-text font-display tracking-[-0.04em]">Pranan</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Platform badge */}
          {currentPlatform !== 'unknown' && (
            <span className="text-[10px] text-brand-text-3 capitalize font-mono px-1.5 py-0.5 rounded bg-brand-surface-2 border border-brand-border">
              {currentPlatform}
            </span>
          )}

          {/* Usage indicator for free tier */}
          {user?.tier === 'free' && user.rateLimit && (
            <span className="text-[10px] text-brand-text-3 font-mono tabular-nums">
              {user.rateLimit.draftsUsedToday}/{user.rateLimit.draftsPerDay}
            </span>
          )}

          <button
            onClick={() => setViewMode('sessions')}
            className="w-6 h-6 flex items-center justify-center text-brand-text-3 hover:text-brand-text rounded-md hover:bg-brand-surface-2 transition-all"
            title="Active sessions"
            aria-label="Active sessions"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </button>

          {/* Sign out */}
          <button
            onClick={logout}
            className="w-6 h-6 flex items-center justify-center text-brand-text-3 hover:text-brand-text rounded-md hover:bg-brand-surface-2 transition-all"
            title="Sign out"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Error banner -- only shown outside of draft view (DraftPanel handles its own errors) */}
      {error && viewMode !== 'draft' && (
        <div className="px-4 py-2.5 bg-brand-red/8 border-b border-brand-red/15 flex items-center justify-between gap-3">
          <p className="text-[11px] text-brand-red leading-relaxed flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-[10px] text-brand-red/50 hover:text-brand-red flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-brand-red/10 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-4 py-3">
        {/* Intelligence views (accessible without compose) */}
        {viewMode === 'briefing' && (
          <BriefingPanel
            briefings={briefings}
            isLoading={isBriefingLoading}
            onBack={() => setViewMode('context')}
            onDraft={handleDraftFromBriefing}
          />
        )}

        {viewMode === 'nudges' && (
          <NudgesPanel
            nudges={nudges}
            decayAlerts={decayAlerts}
            isLoading={isNudgesLoading}
            onBack={() => setViewMode('context')}
            onDismiss={handleDismissNudge}
            onDraftFromNudge={handleDraftFromNudge}
          />
        )}

        {viewMode === 'snippets' && (
          <SnippetsPanel
            onBack={() => setViewMode('context')}
            onInsert={(text) => {
              handleInsertDraft(text);
              setViewMode('context');
            }}
          />
        )}

        {viewMode === 'sessions' && (
          <SessionsPanel onBack={() => setViewMode('context')} onCurrentRevoked={() => { void logout(); }} />
        )}

        {/* No compose detected -- contextual intelligence hub */}
        {!composeContext && viewMode !== 'draft' && viewMode !== 'rewrite' && viewMode !== 'grammar' && viewMode !== 'briefing' && viewMode !== 'nudges' && viewMode !== 'snippets' && viewMode !== 'sessions' && (
          <>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                {/* Contextual greeting */}
                <div className="py-3">
                  <p className="text-sm font-light text-brand-text tracking-[-0.04em]">
                    {currentPlatform === 'gmail' ? 'Your inbox, augmented.' : currentPlatform !== 'unknown' ? `Pranan on ${currentPlatform}` : 'Pranan Companion'}
                  </p>
                  <p className="text-[11px] text-brand-text-3 mt-0.5">
                    {currentPlatform === 'gmail'
                      ? 'Open an email or compose to see relationship context.'
                      : 'Navigate to a conversation to activate.'}
                  </p>
                </div>

                {/* v0.8.6 — Contact Context moved to TOP. When the user has a thread open
                    or a compose context, the contact is the most relevant info. Intelligence
                    + Quick Actions follow. */}
                {contactContext && (
                  <div className="space-y-2">
                    <p className="section-label">Contact Context</p>
                    <ContactCard
                      context={contactContext}
                      recipientName={contactContextLookup?.name ?? null}
                      recipientEmail={contactContextLookup?.email ?? null}
                    />
                  </div>
                )}

                {/* Intelligence cards */}
                <div className="space-y-2">
                  <p className="section-label">Intelligence</p>

                  {/* Meeting briefings */}
                  <button
                    onClick={() => setViewMode('briefing')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm border border-brand-border bg-brand-surface hover:border-brand-border-strong transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-400">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-brand-text font-medium">Meeting briefings</p>
                      <p className="text-[10px] text-brand-text-3">
                        {briefings.length > 0 ? `${briefings.length} upcoming` : 'No meetings today'}
                      </p>
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-text-3">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  {/* Follow-ups & decay alerts */}
                  <button
                    onClick={() => setViewMode('nudges')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm border border-brand-border bg-brand-surface hover:border-brand-border-strong transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-brand-text font-medium">Follow-ups & alerts</p>
                      <p className="text-[10px] text-brand-text-3">
                        {nudges.length > 0 || decayAlerts.length > 0
                          ? `${nudges.length} nudge${nudges.length !== 1 ? 's' : ''}${decayAlerts.length > 0 ? `, ${decayAlerts.length} alert${decayAlerts.length !== 1 ? 's' : ''}` : ''}`
                          : 'All caught up'}
                      </p>
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-text-3">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  {/* Snippets — insert saved chunks into compose */}
                  <button
                    onClick={() => setViewMode('snippets')}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm border border-brand-border bg-brand-surface hover:border-brand-border-strong transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-md bg-brand-accent/10 border border-brand-accent/20 flex items-center justify-center flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="9" y1="13" x2="15" y2="13" />
                        <line x1="9" y1="17" x2="13" y2="17" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-brand-text font-medium">Snippets</p>
                      <p className="text-[10px] text-brand-text-3">
                        Insert saved templates into compose
                      </p>
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-text-3">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>

                {/* Quick actions */}
                <div className="space-y-2">
                  <p className="section-label">Quick Actions</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={appUrl("/relationships")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-sm border border-brand-border bg-brand-surface hover:border-brand-border-strong transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent/60">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span className="text-[10px] text-brand-text-3 font-medium">Relationships</span>
                    </a>
                    <a
                      href={appUrl("/memory")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-sm border border-brand-border bg-brand-surface hover:border-brand-border-strong transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent/60">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                      <span className="text-[10px] text-brand-text-3 font-medium">Memory</span>
                    </a>
                  </div>
                </div>

                {/* Keyboard shortcut hint */}
                <div className="pt-2">
                  <p className="text-[10px] text-brand-text-3/40 text-center">
                    Tip: Press <kbd className="text-[10px] bg-brand-surface-2 border border-brand-border rounded px-1 py-0.5 font-mono">Cmd+Shift+P</kbd> to toggle this panel
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Compose active -- context view needs composeContext */}
        {composeContext && viewMode === 'context' && (
          <div className="space-y-3 animate-fade-in">
            <section className="rounded-lg border border-brand-accent/15 bg-brand-accent/[0.045] px-3 py-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md bg-brand-accent/10 text-brand-accent">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold text-brand-text">{isReplyCompose ? 'Reply in your voice' : 'Draft a new email'}</h2>
                    <span className="rounded-full border border-brand-border bg-brand-bg px-1.5 py-0.5 text-[9px] font-medium text-brand-text-3">
                      {isReplyCompose ? 'Reply' : 'New email'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-brand-text-3">
                    {recipientLabel ? `With context for ${recipientLabel}` : 'Add a recipient when you are ready'}
                  </p>
                </div>
              </div>
            </section>

            {contactContext ? (
              <div className="rounded-lg border border-brand-border bg-brand-surface p-3">
                <ContactCard
                  context={contactContext}
                  recipientName={composeContext.recipientName}
                  recipientEmail={composeContext.recipientEmail}
                />
              </div>
            ) : isLoading ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-brand-border bg-brand-surface px-3 py-2.5 animate-fade-in">
                <div className="relative h-4 w-4 flex-none">
                  <div className="absolute inset-0 border-2 border-brand-accent/15 rounded-full" />
                  <div className="absolute inset-0 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
                </div>
                <span className="text-[10px] text-brand-text-3">Loading relationship context...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg border border-brand-border bg-brand-surface px-3 py-2.5 animate-fade-in">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-brand-text-3" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <p className="text-[10px] text-brand-text-3">
                  {composeContext.recipientEmail
                    ? `No saved relationship context yet for ${composeContext.recipientEmail}.`
                    : 'Add a recipient to personalize tone and relationship context.'}
                </p>
              </div>
            )}

            <section className="space-y-1.5" aria-labelledby="reply-starting-points">
              <p id="reply-starting-points" className="text-[10px] font-medium text-brand-text-3">Start with an outcome</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  ['Acknowledge', 'Acknowledge the message and confirm the next step.'],
                  ['Answer directly', 'Answer the main question directly and keep the reply brief.'],
                  ['Clarify', 'Ask one clear follow-up question before committing to anything.'],
                ].map(([label, prompt]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setQuickPrompt(prompt)}
                    className={`min-h-[44px] rounded-md border px-2 py-1.5 text-left text-[10px] font-medium leading-tight transition-colors ${
                      quickPrompt === prompt
                        ? 'border-brand-accent/35 bg-brand-accent/8 text-brand-accent'
                        : 'border-brand-border bg-brand-surface text-brand-text-2 hover:border-brand-border-strong hover:bg-brand-surface-2'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-1.5" aria-labelledby="reply-tools">
              <p id="reply-tools" className="text-[10px] font-medium text-brand-text-3">More from Pranan</p>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setViewMode('snippets')}
                  className="rounded-md border border-brand-border bg-brand-surface px-2 py-2 text-[10px] font-medium text-brand-text-2 hover:border-brand-border-strong hover:bg-brand-surface-2"
                >
                  Snippets
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('nudges')}
                  className="rounded-md border border-brand-border bg-brand-surface px-2 py-2 text-[10px] font-medium text-brand-text-2 hover:border-brand-border-strong hover:bg-brand-surface-2"
                >
                  Follow-ups
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('briefing')}
                  className="rounded-md border border-brand-border bg-brand-surface px-2 py-2 text-[10px] font-medium text-brand-text-2 hover:border-brand-border-strong hover:bg-brand-surface-2"
                >
                  Briefings
                </button>
              </div>
            </section>
          </div>
        )}

        {/* Draft/Rewrite/Grammar views render independently of composeContext
            so they work from nudge-drafts, briefing-drafts, or timing edge cases */}
        {viewMode === 'draft' && (
          <DraftPanel
            onStop={() => useStore.getState().cancelDraft()}
            draft={currentDraft || { draft: '', confidence: 0, voiceMatch: 0, alternativeTones: [] }}
            isLoading={isDraftLoading}
            streamingText={isDraftStreaming ? streamingDraftText : undefined}
            recipientEmail={composeContext?.recipientEmail}
            recipientName={composeContext?.recipientName}
            subject={null}
            error={error}
            onInsert={handleInsertDraft}
            onRegenerate={handleRegenerateDraft}
            onBack={() => {
              clearDraft();
              setError(null);
              setViewMode('context');
            }}
          />
        )}

        {viewMode === 'rewrite' && (
          <RewritePanel
            selectedText={composeContext?.selectedText || ''}
            result={rewriteResult}
            isLoading={isRewriteLoading}
            onAccept={handleAcceptRewrite}
            onBack={() => {
              clearRewrite();
              setViewMode('context');
            }}
          />
        )}

        {viewMode === 'grammar' && (
          <GrammarPanel
            result={grammarResult || { corrections: [], toneFlags: [], overallScore: 0, suggestions: [] }}
            isLoading={isGrammarLoading}
            onBack={() => {
              clearGrammar();
              setViewMode('context');
            }}
          />
        )}
      </main>

      {/* Bottom toolbar -- only when compose is active */}
      {composeContext && viewMode === 'context' && (
        <footer className="px-4 py-3 border-t border-brand-border bg-brand-bg/95 backdrop-blur flex-shrink-0">
          <div className="mb-2.5">
            <VoicePromptField
              value={quickPrompt}
              onChange={setQuickPrompt}
              onSubmit={handleGenerateDraft}
              disabled={isDraftLoading}
              placeholder={composePromptPlaceholder}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <select
              value={quickTone}
              onChange={(event) => setQuickTone(event.target.value)}
              aria-label="Email tone"
              className="h-[38px] max-w-[112px] flex-none rounded-md border border-brand-border bg-brand-surface px-2 text-[10px] font-medium text-brand-text-2 focus:border-brand-accent/40 focus:outline-none"
            >
              <option value="">Match my voice</option>
              <option value="warm">Warm</option>
              <option value="direct">Direct</option>
              <option value="formal">Formal</option>
            </select>
            <button
              onClick={handleGenerateDraft}
              disabled={isDraftLoading}
              className="btn-accent flex-1 min-h-[38px] text-xs py-2.5 px-3 flex items-center justify-center gap-1.5"
            >
              {isDraftLoading ? (
                <>
                  <div className="w-3 h-3 border-1.5 border-brand-on-accent/40 border-t-brand-on-accent rounded-full animate-spin" />
                  Drafting...
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  {composeActionLabel}
                </>
              )}
            </button>

            {composeContext.selectedText && (
              <>
                <button
                  onClick={handleRewrite}
                  disabled={isRewriteLoading}
                  className="px-3 py-2.5 text-xs text-brand-text-2 border border-brand-border rounded-md hover:border-brand-border-strong hover:text-brand-text hover:bg-brand-surface transition-all disabled:opacity-40"
                >
                  Rewrite
                </button>
                <button
                  onClick={handleGrammarCheck}
                  disabled={isGrammarLoading}
                  className="px-3 py-2.5 text-xs text-brand-text-2 border border-brand-border rounded-md hover:border-brand-border-strong hover:text-brand-text hover:bg-brand-surface transition-all disabled:opacity-40"
                >
                  Check
                </button>
              </>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
