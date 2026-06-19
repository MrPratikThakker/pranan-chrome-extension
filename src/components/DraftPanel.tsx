/**
 * Draft Panel
 *
 * Shows generated draft with Insert, Edit, and Regenerate actions.
 * Polished UI with streaming text, tone chips, error/empty states,
 * and clear action hierarchy.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { DraftResponse } from '@/types';

interface Props {
  draft: DraftResponse;
  isLoading: boolean;
  streamingText?: string;
  recipientEmail?: string | null;
  recipientName?: string | null;
  subject?: string | null;
  error?: string | null;
  onInsert: (text: string, onResult?: (ok: boolean) => void) => void;
  onRegenerate: (tone?: string) => void;
  onBack: () => void;
}

const TONE_CHIPS = [
  { label: 'Friendly', value: 'friendly', icon: '~' },
  { label: 'Professional', value: 'professional', icon: '/' },
  { label: 'Direct', value: 'direct', icon: '>' },
  { label: 'Warm', value: 'warm', icon: '*' },
  { label: 'Concise', value: 'concise', icon: '-' },
];

export function DraftPanel({
  draft,
  isLoading,
  streamingText,
  recipientEmail,
  recipientName,
  subject,
  error,
  onInsert,
  onRegenerate,
  onBack,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(draft.draft);
  const [selectedTone, setSelectedTone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Audit (MEDIUM/LOW): acknowledge whether the content script actually
  // inserted. 'idle' | 'inserting' | 'ok' | 'fail'.
  const [insertState, setInsertState] = useState<'idle' | 'inserting' | 'ok' | 'fail'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditedText(draft.draft);
    setIsEditing(false);
    setInsertState('idle');
  }, [draft.draft]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (streamingText && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [streamingText]);

  const handleInsert = () => {
    setInsertState('inserting');
    onInsert(isEditing ? editedText : draft.draft, (ok) => {
      setInsertState(ok ? 'ok' : 'fail');
      if (ok) setTimeout(() => setInsertState('idle'), 2500);
    });
  };

  const handleToneClick = (tone: string) => {
    setSelectedTone(tone);
    onRegenerate(tone);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(isEditing ? editedText : draft.draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayText = streamingText || draft.draft;
  const hasContent = displayText && displayText.length > 0;
  const recipientDisplay = recipientName || recipientEmail;

  return (
    <div className="animate-slide-up flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-brand-text-3 hover:text-brand-text transition-colors group"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:-translate-x-0.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        {/* Voice match badge */}
        {!isLoading && draft.voiceMatch > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand-surface-2 border border-brand-border">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: draft.voiceMatch > 0.7 ? '#34d399' : draft.voiceMatch > 0.4 ? '#fbbf24' : '#ef4444',
              }}
            />
            <span className="text-[10px] text-brand-text-3 font-mono">
              {Math.round(draft.voiceMatch * 100)}% voice
            </span>
          </div>
        )}
      </div>

      {/* Recipient context */}
      {recipientDisplay && (
        <div className="flex items-center gap-2.5 mb-3 px-3 py-2.5 rounded-lg bg-brand-surface border border-brand-border">
          <div className="w-7 h-7 rounded-md bg-brand-accent/12 border border-brand-accent/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[11px] font-semibold text-brand-accent">
              {recipientDisplay[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-text font-medium truncate">
              {recipientDisplay}
            </p>
            {subject && (
              <p className="text-[10px] text-brand-text-3 truncate mt-0.5">
                Re: {subject}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tone chips */}
      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-0.5">
        <span className="section-label text-[9px] mr-0.5 flex-shrink-0" style={{ letterSpacing: '1.5px' }}>Tone</span>
        {TONE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            onClick={() => handleToneClick(chip.value)}
            disabled={isLoading}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-all whitespace-nowrap flex-shrink-0 ${
              selectedTone === chip.value
                ? 'border-brand-accent/40 bg-brand-accent/10 text-brand-accent'
                : 'border-brand-border text-brand-text-3 hover:border-brand-accent/25 hover:text-brand-text-2'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Draft content area */}
      <div
        ref={contentRef}
        className="glass-card p-4 mb-3 flex-1 overflow-y-auto min-h-[140px] max-h-[360px]"
      >
        {/* Loading state */}
        {isLoading && !hasContent ? (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="relative w-10 h-10">
              <div className="absolute inset-0 border-2 border-brand-accent/15 rounded-full" />
              <div className="absolute inset-0 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-2 border border-brand-accent/30 border-b-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
            <div className="text-center">
              <p className="text-xs text-brand-text-2 font-medium">Drafting reply...</p>
              <p className="text-[10px] text-brand-text-3 mt-1">Analyzing tone, context, and relationship</p>
            </div>
          </div>
        ) : !hasContent && !isLoading && error ? (
          /* Error state */
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="w-10 h-10 rounded-lg bg-brand-red/8 border border-brand-red/15 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-red">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-brand-text-2 font-medium mb-1">Could not generate draft</p>
              <p className="text-[11px] text-brand-text-3 max-w-[220px] leading-relaxed">{error}</p>
            </div>
            <button
              onClick={() => onRegenerate()}
              className="btn-accent text-xs py-2 px-5 mt-1"
            >
              Try again
            </button>
          </div>
        ) : !hasContent && !isLoading ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <div className="w-10 h-10 rounded-lg bg-brand-surface-2 border border-brand-border flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-text-3">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <p className="text-xs text-brand-text-3">Ready to draft.</p>
            <button
              onClick={() => onRegenerate()}
              className="btn-accent text-xs py-2 px-5"
            >
              Generate draft
            </button>
          </div>
        ) : isEditing ? (
          /* Edit mode */
          <textarea
            ref={textareaRef}
            value={editedText}
            onChange={(e) => {
              setEditedText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            className="w-full text-[13px] text-brand-text resize-none border-none outline-none bg-transparent min-h-[100px] leading-relaxed"
          />
        ) : (
          /* Display mode */
          <div className="text-[13px] text-brand-text-2 whitespace-pre-wrap leading-[1.65]">
            {displayText}
            {isLoading && (
              <span className="inline-block w-0.5 h-4 bg-brand-accent ml-0.5 animate-pulse align-text-bottom" />
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      {hasContent && !isLoading && (
        <div className="space-y-2.5">
          {/* Primary row */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleInsert}
              disabled={insertState === 'inserting'}
              className="btn-accent flex-1 text-[13px] py-2.5 px-4 flex items-center justify-center gap-2 font-semibold disabled:opacity-60"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 11 12 14 22 4" />
              </svg>
              {insertState === 'inserting' ? 'Inserting...' : insertState === 'ok' ? 'Inserted' : 'Insert'}
            </button>

            <button
              onClick={() => setIsEditing(!isEditing)}
              className="w-10 h-10 flex items-center justify-center text-brand-text-3 border border-brand-border rounded-md hover:border-brand-border-strong hover:text-brand-text hover:bg-brand-surface transition-all"
              title={isEditing ? 'Preview' : 'Edit'}
            >
              {isEditing ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              )}
            </button>

            <button
              onClick={() => onRegenerate()}
              className="w-10 h-10 flex items-center justify-center text-brand-text-3 border border-brand-border rounded-md hover:border-brand-border-strong hover:text-brand-text hover:bg-brand-surface transition-all"
              title="Regenerate"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 4v6h6" />
                <path d="M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
            </button>
          </div>

          {/* Audit (MEDIUM/LOW): insertion failed (no compose / editor changed /
              content script gone). Tell the user and offer copy. */}
          {insertState === 'fail' && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <span>Could not insert. Copy the draft instead?</span>
              <button
                onClick={handleCopy}
                className="flex-none rounded bg-amber-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-800"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}

          {/* Secondary: copy */}
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] text-brand-text-3 hover:text-brand-text py-1.5 transition-colors"
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-green">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-brand-green">Copied</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy to clipboard
              </>
            )}
          </button>
        </div>
      )}

      {/* Suggested alternative tones from API */}
      {draft.alternativeTones.length > 0 && !isLoading && (
        <div className="mt-3 pt-3 border-t border-brand-border">
          <p className="section-label mb-2 text-[9px]">Variations</p>
          <div className="flex flex-wrap gap-1.5">
            {draft.alternativeTones.map((alt, i) => (
              <button
                key={i}
                onClick={() => onRegenerate(alt.tone)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-brand-border text-brand-text-3 hover:border-brand-accent/30 hover:text-brand-accent transition-colors"
              >
                {alt.tone}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
