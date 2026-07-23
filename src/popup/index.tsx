/**
 * Extension Popup -- Today at a Glance
 *
 * One-tap visibility into Pranan's state without opening the full app.
 * The popup is the highest-frequency surface (toolbar click), so the
 * highest-value content has to fit above the fold:
 *
 *   1. Drafts ready right now -- the Send queue size
 *   2. Threads still awaiting your reply -- inbox triage size
 *   3. Voice score with delta vs. last week
 *   4. Pipeline health pill (mirrors sidebar pill in the app)
 *   5. Top nudge (the one follow-up most worth doing today)
 *
 * Below: the existing quick-action buttons (Draft, Grammar, Open panel).
 * Auth-not-connected and not-on-supported-site states still render
 * cleanly. Numbers fetch in parallel from /api/companion/today which is
 * a single roundtrip the app caches for 60s.
 */

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Platform, AuthResponse } from '@/types';
import { getTodaySnapshot, type TodaySnapshot } from '@/lib/api-client';
import { bootstrapSentry } from '@/lib/observability';
import { appUrl } from '@/lib/config';


bootstrapSentry('popup');

interface PopupState {
  isAuthenticated: boolean;
  isAuthChecked: boolean;
  user: AuthResponse | null;
  platform: Platform;
  hasActiveCompose: boolean;
  snapshot: TodaySnapshot | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
}

function Popup() {
  const [state, setState] = useState<PopupState>({
    isAuthenticated: false,
    isAuthChecked: false,
    user: null,
    platform: 'unknown',
    hasActiveCompose: false,
    snapshot: null,
    snapshotLoading: true,
    snapshotError: null,
  });

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const url = tabs[0]?.url || '';
      let platform: Platform = 'unknown';
      if (url.includes('mail.google.com')) platform = 'gmail';
      else if (url.includes('app.slack.com')) platform = 'slack';
      else if (url.includes('linkedin.com')) platform = 'linkedin';
      else platform = 'universal';

      // Auth resolution is split into two phases to eliminate the
      // 'Connect Account' flicker on cold popup open. The bug:
      // previously we awaited Promise.all([storage, AUTH_STATUS,
      // getTodaySnapshot]) which gated isAuthenticated on a ~1-2s
      // network round-trip to /api/companion/today. During that window
      // the popup rendered the unauth shell.
      //
      // Phase 1 (~10-50ms): resolve auth state from local sources only
      // (chrome.storage + SW cachedAuth). setState immediately so the
      // authed shell renders before the snapshot arrives.
      //
      // Phase 2 (~1-2s): fetch today snapshot in the background, fill
      // it in. snapshotLoading stays true until this completes so the
      // numbers section can show its skeleton.
      const [storage, authResp] = await Promise.all([
        chrome.storage.local.get(['authToken', 'lastKnownAuthValid']).catch(() => ({} as Record<string, unknown>)),
        chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }).catch(() => null),
      ]);

      const hasStoredToken = !!(storage as { authToken?: string }).authToken;
      const hintValid = (storage as { lastKnownAuthValid?: boolean }).lastKnownAuthValid === true;
      const swValid = !!authResp?.auth?.valid;
      // Post-v0.4.0 cookie auth: hintValid alone is sufficient (no token
      // needed). Pre-v0.4.0: fall back to stored Bearer presence + hint.
      const optimisticAuth = swValid || hintValid || hasStoredToken;

      setState((s) => ({
        ...s,
        isAuthenticated: optimisticAuth,
        isAuthChecked: true,
        user: authResp?.auth || null,
        platform,
        hasActiveCompose: false,
      }));

      // Phase 2: snapshot fetch in the background. Doesn't block render.
      // Capture error so we can surface a small banner instead of staying silent.
      let snapshot: TodaySnapshot | null = null;
      let snapshotError: string | null = null;
      try {
        snapshot = await getTodaySnapshot();
      } catch (e) {
        snapshotError = e instanceof Error ? e.message : 'Could not load today\'s snapshot';
      }
      setState((s) => ({
        ...s,
        snapshot,
        snapshotLoading: false,
        snapshotError,
      }));
    });
  }, []);

  // Listen for auth state changes broadcast by the SW. This is the
  // popup-side counterpart to v0.4.5's AUTH_RECOVERED auto-recovery
  // flow. Without this, a transient 401 -> 200 cycle that happens while
  // the popup is open would leave the popup showing stale unauth state
  // until the user closes and reopens it.
  useEffect(() => {
    const handler = (msg: { type?: string; payload?: { valid?: boolean; user?: AuthResponse } }) => {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'AUTH_RECOVERED') {
        setState((s) => ({ ...s, isAuthenticated: true }));
      } else if (msg.type === 'AUTH_STATUS') {
        const valid = !!msg.payload?.valid;
        setState((s) => ({
          ...s,
          isAuthenticated: valid,
          user: valid ? (msg.payload?.user ?? s.user) : null,
        }));
      } else if (msg.type === 'AUTH_EXPIRED') {
        setState((s) => ({ ...s, isAuthenticated: false, user: null }));
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const openSidePanel = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.sidePanel.open({ tabId: tabs[0].id });
        window.close();
      }
    });
  };

  const openTriage = () => {
    chrome.tabs.create({ url: appUrl('/triage') });
    window.close();
  };

  const openHome = () => {
    chrome.tabs.create({ url: appUrl('/home') });
    window.close();
  };

  const openLogin = () => {
    chrome.tabs.create({ url: appUrl('/login?source=companion') });
    window.close();
  };

  const disconnect = async () => {
    // Clear the stored Bearer + refresh tokens DIRECTLY from the popup. Doing the
    // removal here (not only via a DISCONNECT message to the service worker) fixes
    // the MV3 race where window.close() tore down the popup's message port before
    // the message reached the SW, so tokens were never cleared and "Disconnect"
    // appeared to do nothing (Pratik 2026-07-22). Web sign-out does not revoke the
    // extension's own session, so this explicit control must be reliable.
    try { await chrome.storage.local.remove(['authToken', 'refreshToken']); } catch { /* pass */ }
    // Then notify the SW to drop its cached auth + update the side panel; await so
    // it is actually delivered before we close. SW asleep is fine -- storage (the
    // source of truth) is already cleared.
    try { await chrome.runtime.sendMessage({ type: 'DISCONNECT' }); } catch { /* pass */ }
    window.close();
  };

  const quickDraft = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_INLINE_DRAFT' }).catch(() => {});
        chrome.sidePanel.open({ tabId: tabs[0].id });
        window.close();
      }
    });
  };

  const quickGrammar = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_INLINE_GRAMMAR' }).catch(() => {});
        chrome.sidePanel.open({ tabId: tabs[0].id });
        window.close();
      }
    });
  };

  const platformLabel = state.platform === 'unknown' ? 'Any page' :
    state.platform === 'universal' ? document.title?.slice(0, 20) || 'Web page' :
    state.platform.charAt(0).toUpperCase() + state.platform.slice(1);

  const snap = state.snapshot;
  const voiceArrow = snap?.voiceDirection === 'up' ? '↑' : snap?.voiceDirection === 'down' ? '↓' : '→';
  const voiceColor = snap?.voiceDirection === 'up' ? '#34d399' : snap?.voiceDirection === 'down' ? '#f87171' : 'rgba(10,10,11,0.5)';

  return (
    <div style={{
      width: 320,
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      background: '#ffffff',
      color: '#0a0a0b',
      padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'rgba(167,139,250,0.15)',
          border: '1px solid rgba(167,139,250,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="popupBrandGrad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#4c1d95" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="33" stroke="url(#popupBrandGrad)" strokeWidth="7" fill="none" />
            <circle cx="60" cy="60" r="16" fill="url(#popupBrandGrad)" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 300, letterSpacing: '-0.04em', fontFamily: "'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>Pranan</div>
          <div style={{ fontSize: 10, color: 'rgba(10,10,11,0.4)' }}>{platformLabel}</div>
        </div>
        {state.isAuthenticated && snap && (() => {
          // Status semantics, friendlier than the previous binary badge:
          //   Active   — pipelineHealthy=true, last_sync within window
          //   Syncing  — last_sync=null (cron hasn't recorded yet, or just
          //              after a force-resync). NOT an error; nothing for
          //              the user to do. Will self-resolve on next cron tick.
          //   Issue    — pipelineHealthy=false AND lastSyncAgo present but
          //              stale, OR another real error condition. Only this
          //              state should alarm; renamed away from 'Degraded'
          //              which read as broken to users.
          const isActive = snap.pipelineHealthy;
          const isSyncing = !snap.pipelineHealthy && !snap.lastSyncAgo;
          // 'Issue' is the residual case: not healthy AND we have a stale
          // last_sync timestamp (so sync ran but is now older than threshold).
          const label = isActive ? 'Active' : isSyncing ? 'Syncing' : 'Issue';
          const palette = isActive
            ? { bg: 'rgba(52,211,153,0.12)', fg: '#34d399' }
            : isSyncing
            ? { bg: 'rgba(250,204,21,0.12)', fg: '#facc15' }
            : { bg: 'rgba(248,113,113,0.12)', fg: '#f87171' };
          return (
            <div style={{
              marginLeft: 'auto',
              fontSize: 9, fontWeight: 600,
              textTransform: 'uppercase' as const,
              letterSpacing: 1,
              padding: '2px 6px',
              borderRadius: 3,
              background: palette.bg,
              color: palette.fg,
            }}>{label}</div>
          );
        })()}
      </div>

      {/* Auth checking — soft skeleton instead of flashing the unauth CTA at returning users */}
      {!state.isAuthChecked && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: '60%',
            height: 8,
            margin: '0 auto 10px',
            borderRadius: 4,
            background: 'rgba(10,10,11,0.06)',
            animation: 'pranan-pulse 1.4s ease-in-out infinite',
          }} />
          <div style={{
            width: '40%',
            height: 8,
            margin: '0 auto',
            borderRadius: 4,
            background: 'rgba(10,10,11,0.06)',
            animation: 'pranan-pulse 1.4s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* Not authenticated — only after first check has actually resolved unauthenticated */}
      {state.isAuthChecked && !state.isAuthenticated && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <p style={{ fontSize: 12, color: 'rgba(10,10,11,0.6)', marginBottom: 4, fontWeight: 500 }}>
            Sign in to Pranan
          </p>
          <p style={{ fontSize: 11, color: 'rgba(10,10,11,0.4)', marginBottom: 12 }}>
            Already have an account? Click below to reconnect.
          </p>
          <button onClick={openLogin} style={{
            width: '100%', padding: '8px 16px',
            fontSize: 12, fontWeight: 600,
            color: '#fafafa',
            background: 'linear-gradient(135deg, #6d28d9, #a78bfa)',
            border: 'none', borderRadius: 6, cursor: 'pointer',
          }}>
            Continue to Pranan
          </button>
        </div>
      )}

      {/* Snapshot fetch error — quiet, dismissible, non-blocking. Better than silent. */}
      {state.isAuthenticated && state.snapshotError && (
        <div style={{
          marginBottom: 8,
          padding: '8px 10px',
          borderRadius: 6,
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.18)',
          fontSize: 11,
          color: 'rgba(248,113,113,0.85)',
        }}>
          Couldn't refresh your snapshot. Showing last known state.
        </div>
      )}

      {/* Authenticated -- today at a glance */}
      {state.isAuthenticated && (
        <>
          {/* Two-up stat tiles. Real pulsing skeletons during load — feels like
              "fetching", not "broken". Numbers slot in as soon as snap arrives. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <button onClick={openTriage} style={tileBtn}>
              <div style={tileLabel}>Drafts ready</div>
              {state.snapshotLoading && !snap ? (
                <div style={skeletonNumber} />
              ) : (
                <div style={tileValue}>{snap?.draftsReady ?? '—'}</div>
              )}
              <div style={tileSub}>Tap to triage</div>
            </button>
            <button onClick={openTriage} style={tileBtn}>
              <div style={tileLabel}>Awaiting you</div>
              {state.snapshotLoading && !snap ? (
                <div style={skeletonNumber} />
              ) : (
                <div style={tileValue}>{snap?.threadsAwaiting ?? '—'}</div>
              )}
              <div style={tileSub}>To Respond</div>
            </button>
          </div>

          {/* Voice score + last sync */}
          <button onClick={openHome} style={{
            ...tileBtn,
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 12, marginBottom: 8,
            textAlign: 'left' as const,
          }}>
            <div>
              <div style={tileLabel}>Voice score</div>
              {state.snapshotLoading && !snap ? (
                <div style={skeletonNumber} />
              ) : (
                <div style={{ ...tileValue, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  {snap?.voiceScore ?? '—'}
                  {snap?.voiceScore != null && snap?.voiceDelta !== 0 && (
                    <span style={{ fontSize: 11, color: voiceColor }}>{voiceArrow} {Math.abs(snap.voiceDelta)}</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div style={tileLabel}>Last sync</div>
              {state.snapshotLoading && !snap ? (
                <div style={skeletonText} />
              ) : (
                <div style={tileValue}>{snap?.lastSyncAgo ?? '—'}</div>
              )}
            </div>
          </button>

          {/* Top nudge */}
          {snap?.topNudge && (
            <div style={{
              marginBottom: 8,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(167,139,250,0.08)',
              border: '1px solid rgba(167,139,250,0.18)',
            }}>
              <div style={{ ...tileLabel, color: 'rgba(167,139,250,0.7)' }}>Today's nudge</div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 4, marginBottom: 6 }}>
                Reply to {snap.topNudge.recipient}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(10,10,11,0.5)' }}>
                {snap.topNudge.subject}
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <button onClick={quickDraft} style={actionBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
                <rect x="5" y="5" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
                <rect x="8" y="8" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.7"/>
                <rect x="10" y="10" width="4" height="4" rx="1" fill="currentColor"/>
              </svg>
              <span>Draft in my voice</span>
            </button>

            <button onClick={quickGrammar} style={actionBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Check grammar & tone</span>
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(10,10,11,0.06)', margin: '8px 0' }} />

          {/* Usage */}
          {state.user?.tier === 'free' && state.user.rateLimit && (
            <div style={{ fontSize: 10, color: 'rgba(10,10,11,0.35)', marginBottom: 8 }}>
              {state.user.rateLimit.draftsUsedToday}/{state.user.rateLimit.draftsPerDay} drafts today
            </div>
          )}

          {/* Open full panel */}
          <button onClick={openSidePanel} style={{
            width: '100%', padding: '6px 12px',
            fontSize: 11, fontWeight: 500,
            color: 'rgba(10,10,11,0.6)',
            background: 'rgba(10,10,11,0.04)',
            border: '1px solid rgba(10,10,11,0.08)',
            borderRadius: 6, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            Open full panel
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          {/* Disconnect — clears the extension's stored tokens (F-13). */}
          <button onClick={() => { void disconnect(); }} style={{
            width: '100%', padding: '6px 12px', marginTop: 6,
            fontSize: 11, fontWeight: 500,
            color: 'rgba(248,113,113,0.85)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            Disconnect
          </button>
        </>
      )}

      {/* Keyboard shortcut hint */}
      <div style={{
        marginTop: 12, textAlign: 'center',
        fontSize: 9, color: 'rgba(10,10,11,0.2)',
      }}>
        Ctrl+Shift+P to toggle side panel
      </div>
    </div>
  );
}

const tileBtn: React.CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(10,10,11,0.04)',
  border: '1px solid rgba(10,10,11,0.08)',
  borderRadius: 6,
  cursor: 'pointer',
  textAlign: 'left' as const,
  fontFamily: 'inherit',
  color: 'inherit',
  width: '100%',
};

const tileLabel: React.CSSProperties = {
  fontSize: 9, fontWeight: 600,
  letterSpacing: 0.8,
  textTransform: 'uppercase' as const,
  color: 'rgba(10,10,11,0.4)',
  marginBottom: 2,
};

const tileValue: React.CSSProperties = {
  fontSize: 20, fontWeight: 600,
  color: '#0a0a0b',
  fontVariantNumeric: 'tabular-nums' as const,
};

const tileSub: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(10,10,11,0.35)',
  marginTop: 2,
};

const skeletonNumber: React.CSSProperties = {
  height: 22,
  width: 32,
  marginTop: 1,
  marginBottom: 1,
  borderRadius: 4,
  background: 'rgba(10,10,11,0.06)',
  animation: 'pranan-pulse 1.4s ease-in-out infinite',
};

const skeletonText: React.CSSProperties = {
  height: 14,
  width: 60,
  marginTop: 4,
  marginBottom: 5,
  borderRadius: 4,
  background: 'rgba(10,10,11,0.06)',
  animation: 'pranan-pulse 1.4s ease-in-out infinite',
};

const actionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '8px 12px',
  fontSize: 12, fontWeight: 500,
  color: 'rgba(10,10,11,0.8)',
  background: 'rgba(10,10,11,0.04)',
  border: '1px solid rgba(10,10,11,0.08)',
  borderRadius: 6, cursor: 'pointer',
  textAlign: 'left' as const,
  fontFamily: 'inherit',
  transition: 'all 0.1s ease',
};

// Mount
const root = document.getElementById('popup-root');
if (root) {
  createRoot(root).render(<Popup />);
}


