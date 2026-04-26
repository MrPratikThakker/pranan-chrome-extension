/**
 * Contact Context Card
 *
 * Shows relationship tier, health, communication DNA,
 * and recent topics for the detected recipient.
 * Polished dark theme with clear visual hierarchy.
 */

import React from 'react';
import type { ContactContext } from '@/types';
import { getTierStyle, getHealthStyle, formatLastInteraction } from '@/lib/utils';

interface Props {
  context: ContactContext;
  recipientName: string | null;
  recipientEmail: string | null;
}

export function ContactCard({ context, recipientName, recipientEmail }: Props) {
  const tier = getTierStyle(context.tier);
  const health = getHealthStyle(context.style.health);

  const displayName = context.style.contactName || recipientName || recipientEmail || 'Unknown';
  const title = context.style.roleTitle;
  const org = context.style.organization;

  return (
    <div className="animate-fade-in space-y-3">
      {/* Header: avatar + name + tier */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-accent/10 border border-brand-accent/15 flex items-center justify-center text-brand-accent font-display text-lg flex-shrink-0">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm text-brand-text truncate">{displayName}</h3>
          {(title || org) && (
            <p className="text-xs text-brand-text-3 truncate mt-0.5">
              {title}{title && org ? ' at ' : ''}{org}
            </p>
          )}
        </div>
      </div>

      {/* Status row: tier badge + health + score */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border ${tier.bg} ${tier.text} ${tier.border}`}>
          {tier.label}
        </span>
        {health && (
          <span className={`text-[11px] font-medium ${health.color}`}>
            {health.label}
          </span>
        )}
        {context.style.healthScore != null && context.style.healthScore > 0 && (
          <span className="text-[11px] text-brand-text-3 ml-auto font-mono tabular-nums">
            {context.style.healthScore}/100
          </span>
        )}
      </div>

      {/* Last interaction */}
      <div className="text-[11px] text-brand-text-3 flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-50">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Last contact: {formatLastInteraction(context.lastInteraction)}
      </div>

      {/* Communication DNA */}
      {context.communicationDNA && (
        <div className="glass-card p-3">
          <h4 className="section-label mb-2.5" style={{ fontSize: '9px' }}>Communication Style</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-brand-text-3">Formality</span>
              <span className="text-brand-text font-medium">
                {context.communicationDNA.formality > 0.7 ? 'Formal' :
                 context.communicationDNA.formality > 0.4 ? 'Balanced' : 'Casual'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-brand-text-3">Length</span>
              <span className="text-brand-text font-medium">
                {context.communicationDNA.avgReplyLength > 200 ? 'Detailed' :
                 context.communicationDNA.avgReplyLength > 80 ? 'Medium' : 'Brief'}
              </span>
            </div>
          </div>
          {context.style.styleNotes && (
            <p className="text-[11px] text-brand-text-3 mt-2.5 pt-2 border-t border-brand-border italic leading-relaxed">
              {context.style.styleNotes}
            </p>
          )}
        </div>
      )}

      {/* Recent Topics */}
      {context.recentTopics.length > 0 && (
        <div>
          <h4 className="section-label mb-2" style={{ fontSize: '9px' }}>Topics</h4>
          <div className="flex flex-wrap gap-1.5">
            {context.recentTopics.slice(0, 6).map((topic, i) => (
              <span
                key={i}
                className="inline-block px-2 py-0.5 rounded-md text-[11px] text-brand-text-3 bg-brand-surface-2 border border-brand-border"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Key Memories */}
      {context.memories.length > 0 && (
        <div>
          <h4 className="section-label mb-2" style={{ fontSize: '9px' }}>Context</h4>
          <div className="space-y-1.5">
            {context.memories.slice(0, 4).map((memory, i) => (
              <div key={i} className="text-[11px] text-brand-text-2 flex items-start gap-2 leading-relaxed">
                <span className="text-brand-accent/60 mt-px flex-shrink-0">{'>'}</span>
                <span>{memory.summary || memory.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
