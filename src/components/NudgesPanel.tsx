/**
 * NudgesPanel -- Follow-up nudges + Decay alerts (Phase 5)
 *
 * Shows proactive follow-up suggestions and relationship
 * decay warnings. Combines nudges and decay alerts in one view.
 */

import React, { useState } from 'react';
import type { FollowUpNudge, DecayAlert } from '@/types';
import { getTierLabel, TIER_LABELS, HEALTH_LABELS } from '@/lib/utils';

interface NudgesPanelProps {
  nudges: FollowUpNudge[];
  decayAlerts: DecayAlert[];
  isLoading: boolean;
  onBack: () => void;
  onDismiss: (nudgeId: string) => void;
  onDraftFromNudge: (nudgeId: string) => void;
}

const priorityColors: Record<string, string> = {
  high: 'text-red-400 bg-red-400/10 border-red-400/20',
  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  low: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
};

export function NudgesPanel({ nudges, decayAlerts, isLoading, onBack, onDismiss, onDraftFromNudge }: NudgesPanelProps) {
  const [activeTab, setActiveTab] = useState<'nudges' | 'decay'>('nudges');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const handleDismiss = (id: string) => {
    setDismissedIds(prev => new Set(prev).add(id));
    onDismiss(id);
  };

  const visibleNudges = nudges.filter(n => !dismissedIds.has(n.id));

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-5 h-5 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-brand-text-3">Loading intelligence...</p>
      </div>
    );
  }

  const hasNudges = visibleNudges.length > 0;
  const hasDecay = decayAlerts.length > 0;

  if (!hasNudges && !hasDecay) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-brand-surface border border-brand-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-text-3">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <p className="text-sm text-brand-text-2 mb-1">All caught up</p>
        <p className="text-xs text-brand-text-3">No pending follow-ups or relationship alerts.</p>
        <button onClick={onBack} className="mt-4 text-xs text-brand-accent hover:underline">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <button onClick={onBack} className="text-xs text-brand-text-3 hover:text-brand-text flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>

      {/* Tabs */}
      {hasNudges && hasDecay && (
        <div className="flex border-b border-brand-border">
          <button
            onClick={() => setActiveTab('nudges')}
            className={`flex-1 text-xs py-2 text-center transition-colors border-b-2 ${
              activeTab === 'nudges'
                ? 'text-brand-accent border-brand-accent'
                : 'text-brand-text-3 border-transparent hover:text-brand-text-2'
            }`}
          >
            Follow-ups ({visibleNudges.length})
          </button>
          <button
            onClick={() => setActiveTab('decay')}
            className={`flex-1 text-xs py-2 text-center transition-colors border-b-2 ${
              activeTab === 'decay'
                ? 'text-brand-accent border-brand-accent'
                : 'text-brand-text-3 border-transparent hover:text-brand-text-2'
            }`}
          >
            Decay alerts ({decayAlerts.length})
          </button>
        </div>
      )}

      {/* Nudges list */}
      {(activeTab === 'nudges' || !hasDecay) && hasNudges && (
        <div className="space-y-2">
          {visibleNudges
            .sort((a, b) => {
              const order = { high: 0, medium: 1, low: 2 };
              return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
            })
            .map((nudge) => {
              const priority = priorityColors[nudge.priority] || priorityColors.low;
              const tierStyle = TIER_LABELS[nudge.tier] || TIER_LABELS.unknown;

              return (
                <div key={nudge.id} className="rounded-sm border border-brand-border bg-brand-surface overflow-hidden">
                  <div className="px-3 py-2.5">
                    {/* Contact + priority */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center">
                          <span className="text-[10px] text-brand-text-3 font-medium">
                            {nudge.contactName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-brand-text font-medium">{nudge.contactName}</span>
                          <span className={`text-[9px] ml-1.5 ${tierStyle.text}`}>{tierStyle.label}</span>
                        </div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${priority}`}>
                        {nudge.priority}
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="text-xs text-brand-text-2 mb-1.5">{nudge.reason}</p>

                    {/* Meta */}
                    <div className="flex items-center gap-3 text-[10px] text-brand-text-3">
                      <span>{nudge.daysSinceLastContact}d since last contact</span>
                      <span>{nudge.suggestedAction}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="px-3 py-2 border-t border-brand-border flex gap-2">
                    <button
                      onClick={() => onDraftFromNudge(nudge.id)}
                      className="flex-1 text-xs py-1.5 px-3 rounded-sm bg-brand-accent/10 text-brand-accent border border-brand-accent/20 hover:bg-brand-accent/15 transition-colors"
                    >
                      Draft follow-up
                    </button>
                    <button
                      onClick={() => handleDismiss(nudge.id)}
                      className="text-xs py-1.5 px-3 rounded-sm text-brand-text-3 border border-brand-border hover:text-brand-text-2 hover:border-brand-border-strong transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Decay alerts list */}
      {(activeTab === 'decay' || !hasNudges) && hasDecay && (
        <div className="space-y-2">
          {decayAlerts.map((alert, i) => {
            const tierStyle = TIER_LABELS[alert.tier] || TIER_LABELS.unknown;
            const prevHealth = HEALTH_LABELS[alert.previousHealth] || HEALTH_LABELS.dormant;
            const currHealth = HEALTH_LABELS[alert.currentHealth] || HEALTH_LABELS.dormant;

            return (
              <div key={i} className="rounded-sm border border-brand-border bg-brand-surface overflow-hidden">
                <div className="px-3 py-2.5">
                  {/* Contact */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center">
                      <span className="text-[10px] text-brand-text-3 font-medium">
                        {alert.contactName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-brand-text font-medium">{alert.contactName}</span>
                      <span className={`text-[9px] ml-1.5 ${tierStyle.text}`}>{tierStyle.label}</span>
                    </div>
                  </div>

                  {/* Health change */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-xs ${prevHealth.color}`}>
                      {prevHealth.label}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-text-3">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span className={`text-xs font-medium ${currHealth.color}`}>
                      {currHealth.label}
                    </span>
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-3 text-[10px] text-brand-text-3">
                    <span>{alert.daysSilent}d silent</span>
                    <span>{alert.suggestedAction}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
