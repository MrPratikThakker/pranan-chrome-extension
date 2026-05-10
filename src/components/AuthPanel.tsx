/**
 * Auth Panel
 *
 * Shown when user is not authenticated.
 * Clean onboarding screen with connect CTA.
 */

import React from 'react';

interface Props {
  onConnect: () => void;
}

export function AuthPanel({ onConnect }: Props) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-16 px-6 text-center animate-fade-in">
      {/* Logo */}
      <div className="w-16 h-16 rounded-xl bg-brand-accent/8 border border-brand-accent/15 flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="60" cy="60" r="33" stroke="#a78bfa" strokeWidth="7" fill="none"/>
          <circle cx="60" cy="60" r="16" fill="#a78bfa"/>
        </svg>
      </div>

      <h2 className="text-lg font-light font-display text-brand-text mb-2 tracking-[-0.04em]">
        Pranan
      </h2>

      <p className="text-sm text-brand-text-3 mb-1 max-w-[260px] leading-relaxed">
        AI-powered drafts in your voice.
      </p>
      <p className="text-xs text-brand-text-3/50 mb-8 max-w-[260px]">
        Relationship context, tone matching, and smart replies across Gmail, Slack, and LinkedIn.
      </p>

      <button
        onClick={onConnect}
        className="btn-accent w-full max-w-[240px] py-3 px-6 text-sm"
      >
        Connect to Pranan
      </button>

      <p className="text-[11px] text-brand-text-3/40 mt-4">
        Opens app.pranan.ai to sign in securely
      </p>
    </div>
  );
}
