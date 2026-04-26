/**
 * Empty State
 *
 * Shown when no compose window is active.
 * Clean, minimal design with platform-aware hints.
 */

import React from 'react';
import type { Platform } from '@/types';

interface Props {
  platform: Platform;
  userName?: string;
}

const PLATFORM_HINTS: Record<Platform, { hint: string; action: string }> = {
  gmail: {
    hint: 'Compose an email or reply to a thread.',
    action: 'Pranan will surface relationship context and draft suggestions.',
  },
  slack: {
    hint: 'Open a DM or channel conversation.',
    action: 'Pranan will help you write in context.',
  },
  linkedin: {
    hint: 'Start a message or post.',
    action: 'Pranan will match your professional voice.',
  },
  universal: {
    hint: 'Start typing in any text field.',
    action: 'Pranan suggestions will appear automatically.',
  },
  unknown: {
    hint: 'Navigate to Gmail, Slack, or LinkedIn.',
    action: 'Pranan activates when you start composing.',
  },
};

export function EmptyState({ platform, userName }: Props) {
  const { hint, action } = PLATFORM_HINTS[platform];

  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center animate-fade-in">
      {/* Icon */}
      <div className="w-14 h-14 rounded-xl bg-brand-surface-2 border border-brand-border flex items-center justify-center mb-5">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent/60">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>

      <h3 className="text-sm font-medium text-brand-text mb-2">
        {userName ? `Hey ${userName}` : 'Ready when you are'}
      </h3>

      <p className="text-xs text-brand-text-3 max-w-[240px] leading-relaxed mb-1">
        {hint}
      </p>
      <p className="text-[11px] text-brand-text-3/60 max-w-[240px] leading-relaxed">
        {action}
      </p>

      {platform === 'unknown' && (
        <div className="mt-8 space-y-2.5 w-full max-w-[200px]">
          {(['gmail', 'slack', 'linkedin'] as Platform[]).map(p => (
            <div key={p} className="flex items-center gap-2.5 text-xs text-brand-text-3">
              <div className="w-5 h-5 rounded-md bg-brand-surface-2 border border-brand-border flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] text-brand-accent/60 font-mono uppercase">{p[0]}</span>
              </div>
              <span className="capitalize">{p}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
