/**
 * Extension Popup -- Command Center (Phase 4)
 *
 * Quick-access popup from the extension icon. Shows:
 * - Auth status and quick connect
 * - Current platform detection
 * - Quick actions: Draft, Rewrite, Grammar Check
 * - Intelligence summary: upcoming briefings, nudges, decay alerts
 * - Link to open full side panel
 */

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Platform, AuthResponse } from '@/types';

interface PopupState {
  isAuthenticated: boolean;
  user: AuthResponse | null;
  platform: Platform;
  hasActiveCompose: boolean;
}

function Popup() {
  const [state, setState] = useState<PopupState>({
    isAuthenticated: false,
    user: null,
    platform: 'unknown',
    hasActiveCompose: false,
  });

  useEffect(() => {
    // Get current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const url = tabs[0]?.url || '';
      let platform: Platform = 'unknown';
      if (url.includes('mail.google.com')) platform = 'gmail';
      else if (url.includes('app.slack.com')) platform = 'slack';
      else if (url.includes('linkedin.com')) platform = 'linkedin';
      else platform = 'universal';

      // Check auth
      try {
        const response = await chrome.runtime.sendMessage({ type: 'AUTH_STATUS' });
        setState({
          isAuthenticated: !!response?.auth?.valid,
          user: response?.auth || null,
          platform,
          hasActiveCompose: false,
        });
      } catch {
        setState(s => ({ ...s, platform }));
      }
    });
  }, []);

  const openSidePanel = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.sidePanel.open({ tabId: tabs[0].id });
        window.close();
      }
    });
  };

  const openLogin = () => {
    chrome.tabs.create({ url: 'https://app.pranan.ai/login?source=companion' });
    window.close();
  };

  const quickDraft = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_INLINE_DRAFT' });
        chrome.sidePanel.open({ tabId: tabs[0].id });
        window.close();
      }
    });
  };

  const quickGrammar = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_INLINE_GRAMMAR' });
        chrome.sidePanel.open({ tabId: tabs[0].id });
        window.close();
      }
    });
  };

  const platformLabel = state.platform === 'unknown' ? 'Any page' :
    state.platform === 'universal' ? document.title?.slice(0, 20) || 'Web page' :
    state.platform.charAt(0).toUpperCase() + state.platform.slice(1);

  return (
    <div style={{
      width: 280,
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      background: '#09090b',
      color: '#fafafa',
      padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'rgba(167,139,250,0.15)',
          border: '1px solid rgba(167,139,250,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#a78bfa',
        }}>P</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Pranan</div>
          <div style={{ fontSize: 10, color: 'rgba(250,250,250,0.4)' }}>{platformLabel}</div>
        </div>
        {state.isAuthenticated && (
          <div style={{
            marginLeft: 'auto',
            fontSize: 9, fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: 1,
            padding: '2px 6px',
            borderRadius: 3,
            background: 'rgba(52,211,153,0.12)',
            color: '#34d399',
          }}>Connected</div>
        )}
      </div>

      {/* Not authenticated */}
      {!state.isAuthenticated && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <p style={{ fontSize: 12, color: 'rgba(250,250,250,0.5)', marginBottom: 12 }}>
            Connect your Pranan account to get started.
          </p>
          <button onClick={openLogin} style={{
            width: '100%', padding: '8px 16px',
            fontSize: 12, fontWeight: 600,
            color: '#fafafa',
            background: 'linear-gradient(135deg, #6d28d9, #a78bfa)',
            border: 'none', borderRadius: 6, cursor: 'pointer',
          }}>
            Connect Account
          </button>
        </div>
      )}

      {/* Authenticated -- quick actions */}
      {state.isAuthenticated && (
        <>
          {/* Quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <button onClick={quickDraft} style={actionBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
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
          <div style={{ height: 1, background: 'rgba(250,250,250,0.06)', margin: '8px 0' }} />

          {/* Usage */}
          {state.user?.tier === 'free' && state.user.rateLimit && (
            <div style={{ fontSize: 10, color: 'rgba(250,250,250,0.35)', marginBottom: 8 }}>
              {state.user.rateLimit.draftsUsedToday}/{state.user.rateLimit.draftsPerDay} drafts today
            </div>
          )}

          {/* Open full panel */}
          <button onClick={openSidePanel} style={{
            width: '100%', padding: '6px 12px',
            fontSize: 11, fontWeight: 500,
            color: 'rgba(250,250,250,0.6)',
            background: 'rgba(250,250,250,0.04)',
            border: '1px solid rgba(250,250,250,0.08)',
            borderRadius: 6, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            Open full panel
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </>
      )}

      {/* Keyboard shortcut hint */}
      <div style={{
        marginTop: 12, textAlign: 'center',
        fontSize: 9, color: 'rgba(250,250,250,0.2)',
      }}>
        Ctrl+Shift+P to toggle side panel
      </div>
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '8px 12px',
  fontSize: 12, fontWeight: 500,
  color: 'rgba(250,250,250,0.8)',
  background: 'rgba(250,250,250,0.04)',
  border: '1px solid rgba(250,250,250,0.08)',
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
