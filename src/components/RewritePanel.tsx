/**
 * Rewrite Panel
 *
 * Shows original text vs rewritten version with diff highlighting.
 * Supports one-click accept and copy.
 * Design: matches Pranan app dark theme.
 */

import React from 'react';
import type { RewriteResponse } from '@/types';

interface Props {
  selectedText: string;
  result: RewriteResponse | null;
  isLoading: boolean;
  onAccept: (text: string) => void;
  onBack: () => void;
}

export function RewritePanel({ selectedText, result, isLoading, onAccept, onBack }: Props) {
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
        {result && (
          <span className="text-xs text-brand-text-3 font-mono">
            Voice match: {Math.round(result.voiceMatchScore * 100)}%
          </span>
        )}
      </div>

      {/* Original */}
      <div className="mb-3">
        <h4 className="section-label mb-1">Original</h4>
        <div className="rounded-lg p-3 text-sm text-brand-text-2 bg-brand-red/5 border border-brand-red/15">
          {selectedText}
        </div>
      </div>

      {/* Rewritten */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-4">
          <div className="w-4 h-4 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-brand-text-3">Rewriting in your voice...</span>
        </div>
      ) : result ? (
        <>
          <div className="mb-3">
            <h4 className="section-label mb-1">In Your Voice</h4>
            <div className="rounded-lg p-3 text-sm text-brand-text-2 bg-brand-green/5 border border-brand-green/15">
              {result.rewritten}
            </div>
          </div>

          {/* Changes */}
          {result.changes.length > 0 && (
            <div className="mb-3">
              <h4 className="section-label mb-1.5">Changes Made</h4>
              <ul className="space-y-1">
                {result.changes.map((change, i) => (
                  <li key={i} className="text-xs text-brand-text-3">
                    <span className="line-through text-brand-red/60">{change.original}</span>
                    {' -> '}
                    <span className="text-brand-green">{change.replacement}</span>
                    <span className="italic ml-1 opacity-60">({change.reason})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAccept(result.rewritten)}
              className="btn-accent flex-1 text-sm py-2 px-4"
            >
              Replace Selection
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(result.rewritten)}
              className="px-3 py-2 text-sm text-brand-text-2 border border-brand-border rounded-sm hover:border-brand-border-strong hover:text-brand-text transition-colors"
            >
              Copy
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
