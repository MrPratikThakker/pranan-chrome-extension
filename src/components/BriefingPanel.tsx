/**
 * BriefingPanel -- Pre-meeting briefings (Phase 5)
 *
 * Shows upcoming meetings with attendee relationship context,
 * talking points, open threads, and risk flags.
 */

import React from 'react';
import type { MeetingBriefing } from '@/types';
import { getTierStyle, getHealthStyle, getTierLabel } from '@/lib/utils';

interface BriefingPanelProps {
  briefings: MeetingBriefing[];
  isLoading: boolean;
  onBack: () => void;
  onDraft: (briefing: MeetingBriefing) => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 0) return 'Started';
    if (diffMins < 60) return `In ${diffMins}m`;
    const diffHrs = Math.round(diffMins / 60);
    if (diffHrs < 24) return `In ${diffHrs}h`;
    return `In ${Math.round(diffHrs / 24)}d`;
  } catch {
    return '';
  }
}

export function BriefingPanel({ briefings, isLoading, onBack, onDraft }: BriefingPanelProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-5 h-5 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-brand-text-3">Loading briefings...</p>
      </div>
    );
  }

  if (briefings.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-brand-surface border border-brand-border flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-text-3">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <p className="text-sm text-brand-text-2 mb-1">No upcoming briefings</p>
        <p className="text-xs text-brand-text-3">Briefings appear before meetings with known contacts.</p>
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
        <span className="text-xs text-brand-text-3 font-mono">{briefings.length} upcoming</span>
      </div>

      {/* Briefing cards */}
      {briefings.map((briefing, i) => (
        <div key={i} className="rounded-sm border border-brand-border bg-brand-surface overflow-hidden">
          {/* Meeting header */}
          <div className="px-3 py-2.5 border-b border-brand-border">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium text-brand-text leading-tight">
                {briefing.meetingTitle}
              </h3>
              <span className="text-xs text-brand-accent font-mono whitespace-nowrap">
                {formatRelative(briefing.startTime)}
              </span>
            </div>
            <p className="text-xs text-brand-text-3 mt-0.5">{formatTime(briefing.startTime)}</p>
          </div>

          {/* Attendees */}
          {briefing.attendees.length > 0 && (
            <div className="px-3 py-2 border-b border-brand-border">
              <p className="text-xs text-brand-text-3 mb-1.5">Attendees</p>
              <div className="space-y-1.5">
                {briefing.attendees.map((att, j) => {
                  const tier = getTierStyle(att.tier);
                  const health = getHealthStyle(att.health);
                  return (
                    <div key={j} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center">
                          <span className="text-[9px] text-brand-text-3 font-medium">
                            {att.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs text-brand-text">{att.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tier.bg} ${tier.text} ${tier.border}`}>
                          {tier.label}
                        </span>
                      </div>
                      {health && <span className={`text-[10px] ${health.color}`}>{health.label}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Attendee topics */}
          {briefing.attendees.some(a => a.recentTopics.length > 0) && (
            <div className="px-3 py-2 border-b border-brand-border">
              <p className="text-xs text-brand-text-3 mb-1.5">Recent topics</p>
              <div className="flex flex-wrap gap-1">
                {briefing.attendees
                  .flatMap(a => a.recentTopics)
                  .filter((t, i, arr) => arr.indexOf(t) === i)
                  .slice(0, 8)
                  .map((topic, j) => (
                    <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-brand-accent/10 text-brand-accent border border-brand-accent/15">
                      {topic}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Talking points */}
          {briefing.talkingPoints.length > 0 && (
            <div className="px-3 py-2 border-b border-brand-border">
              <p className="text-xs text-brand-text-3 mb-1.5">Talking points</p>
              <ul className="space-y-1">
                {briefing.talkingPoints.map((point, j) => (
                  <li key={j} className="text-xs text-brand-text-2 flex items-start gap-1.5">
                    <span className="text-brand-accent mt-0.5 flex-shrink-0">-</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Open threads */}
          {briefing.openThreads.length > 0 && (
            <div className="px-3 py-2 border-b border-brand-border">
              <p className="text-xs text-brand-text-3 mb-1.5">Open threads</p>
              <ul className="space-y-1">
                {briefing.openThreads.map((thread, j) => (
                  <li key={j} className="text-xs text-brand-text-2 flex items-start gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0 text-brand-text-3">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {thread}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risk flags */}
          {briefing.riskFlags.length > 0 && (
            <div className="px-3 py-2 border-b border-brand-border bg-red-500/5">
              <p className="text-xs text-red-400 mb-1.5">Risk flags</p>
              <ul className="space-y-1">
                {briefing.riskFlags.map((flag, j) => (
                  <li key={j} className="text-xs text-red-300 flex items-start gap-1.5">
                    <span className="mt-0.5 flex-shrink-0">!</span>
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="px-3 py-2 flex gap-2">
            <button
              onClick={() => onDraft(briefing)}
              className="flex-1 text-xs py-1.5 px-3 rounded-sm bg-brand-accent/10 text-brand-accent border border-brand-accent/20 hover:bg-brand-accent/15 transition-colors"
            >
              Draft prep email
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
