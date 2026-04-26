/**
 * Grammar and Tone Panel
 *
 * Shows grammar corrections, tone flags, and an overall score.
 * One-click accept for individual corrections.
 * Design: matches Pranan app dark theme.
 */

import React, { useState } from 'react';
import type { GrammarResponse, GrammarCorrection } from '@/types';

interface Props {
  result: GrammarResponse;
  isLoading: boolean;
  onBack: () => void;
  onApply?: (correction: GrammarCorrection) => void;
  onApplyAll?: (corrections: GrammarCorrection[]) => void;
}

const TYPE_STYLES = {
  grammar: { bg: 'bg-brand-red/8', border: 'border-brand-red/20', dot: 'bg-brand-red', label: 'Grammar' },
  tone: { bg: 'bg-blue-400/8', border: 'border-blue-400/20', dot: 'bg-blue-400', label: 'Tone' },
  voice: { bg: 'bg-brand-accent/8', border: 'border-brand-accent/20', dot: 'bg-brand-accent', label: 'Voice' },
};

const SEVERITY_COLORS = {
  error: 'text-brand-red',
  warning: 'text-brand-amber',
  info: 'text-blue-400',
};

export function GrammarPanel({ result, isLoading, onBack, onApply, onApplyAll }: Props) {
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set());

  const handleApply = (correction: GrammarCorrection, index: number) => {
    setAppliedIds(prev => new Set(prev).add(index));
    onApply?.(correction);
  };

  const handleApplyAll = () => {
    const unapplied = result.corrections.filter((_, i) => !appliedIds.has(i));
    const allIds = new Set(result.corrections.map((_, i) => i));
    setAppliedIds(allIds);
    onApplyAll?.(unapplied);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <div className="w-4 h-4 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-brand-text-3">Checking grammar and tone...</span>
      </div>
    );
  }

  const hasIssues = result.corrections.length > 0 || result.toneFlags.length > 0;

  return (
    <div className="animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onBack}
          className="text-xs text-brand-text-3 hover:text-brand-text transition-colors"
        >
          Back to context
        </button>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-medium ${
            result.overallScore > 0.8 ? 'text-brand-green' :
            result.overallScore > 0.6 ? 'text-brand-amber' : 'text-brand-red'
          }`}>
            Score: {Math.round(result.overallScore * 100)}
          </span>
        </div>
      </div>

      {/* All Clear */}
      {!hasIssues && (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-lg bg-brand-green/10 border border-brand-green/20 flex items-center justify-center mx-auto mb-2">
            <span className="text-brand-green text-xl">&#10003;</span>
          </div>
          <p className="text-sm font-medium text-brand-text">Looking good!</p>
          <p className="text-xs text-brand-text-3 mt-1">No grammar or tone issues detected.</p>
        </div>
      )}

      {/* Corrections */}
      {result.corrections.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="section-label">
              {result.corrections.length} issue{result.corrections.length !== 1 ? 's' : ''} found
            </h4>
            {onApplyAll && result.corrections.length > 1 && appliedIds.size < result.corrections.length && (
              <button
                onClick={handleApplyAll}
                className="text-[10px] py-1 px-2 rounded-sm bg-brand-accent/10 text-brand-accent border border-brand-accent/20 hover:bg-brand-accent/15 transition-colors"
              >
                Apply all
              </button>
            )}
          </div>
          <div className="space-y-2">
            {result.corrections.map((correction, i) => {
              const style = TYPE_STYLES[correction.type] || TYPE_STYLES.grammar;
              const isApplied = appliedIds.has(i);
              return (
                <div key={i} className={`rounded-lg p-3 ${style.bg} border ${style.border} ${isApplied ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                      <span className="text-xs font-mono font-medium text-brand-text">{style.label}</span>
                    </div>
                    {onApply && !isApplied && (
                      <button
                        onClick={() => handleApply(correction, i)}
                        className="text-[10px] py-0.5 px-2 rounded-sm bg-brand-accent/10 text-brand-accent border border-brand-accent/20 hover:bg-brand-accent/15 transition-colors"
                      >
                        Apply
                      </button>
                    )}
                    {isApplied && (
                      <span className="text-[10px] text-brand-green">Applied</span>
                    )}
                  </div>
                  <p className="text-xs text-brand-text-2 mb-1">
                    <span className="line-through text-brand-red/60">{correction.original}</span>
                    {' -> '}
                    <span className="font-medium text-brand-text">{correction.suggestion}</span>
                  </p>
                  <p className="text-xs text-brand-text-3 italic">{correction.reason}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tone Flags */}
      {result.toneFlags.length > 0 && (
        <div className="mb-4">
          <h4 className="section-label mb-2">Tone Notes</h4>
          <div className="space-y-2">
            {result.toneFlags.map((flag, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 ${SEVERITY_COLORS[flag.severity]}`}>!</span>
                <div>
                  <p className="text-brand-text-2">{flag.flag}</p>
                  <p className="text-brand-text-3 italic">{flag.suggestion}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {result.suggestions.length > 0 && (
        <div>
          <h4 className="section-label mb-1.5">Suggestions</h4>
          <ul className="space-y-1">
            {result.suggestions.map((suggestion, i) => (
              <li key={i} className="text-xs text-brand-text-2 flex items-start gap-1.5">
                <span className="text-brand-accent mt-0.5">{'>'}</span>
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
