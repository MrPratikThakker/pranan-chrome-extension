import React, { useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '@/lib/api-client';
import { createRecordedSpeechInput, type RecordedSpeechInput } from '@/lib/recorded-speech-input';
import { createSpeechInput } from '@/lib/speech-input';

type VoiceMode = 'idle' | 'starting' | 'speech' | 'recording' | 'transcribing';

interface Props {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  disabled?: boolean;
  placeholder?: string;
}

export function VoicePromptField({ value, onChange, onSubmit, disabled = false, placeholder = 'Describe what this message should accomplish' }: Props) {
  const [mode, setMode] = useState<VoiceMode>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const valueRef = useRef(value);
  const prefixRef = useRef('');
  const receivedTranscriptRef = useRef(false);
  const speechRef = useRef<ReturnType<typeof createSpeechInput> | null>(null);
  const recordingRef = useRef<RecordedSpeechInput | null>(null);

  valueRef.current = value;

  useEffect(() => {
    const applyTranscript = (transcript: string) => {
      const cleanTranscript = transcript.trim();
      if (!cleanTranscript) return;
      receivedTranscriptRef.current = true;
      onChange([prefixRef.current, cleanTranscript].filter(Boolean).join(' '));
      setStatus('Listening. Review or edit the words before drafting.');
    };

    const finish = () => {
      setMode('idle');
      if (receivedTranscriptRef.current) {
        setStatus('Voice captured. Review the instructions, then draft.');
      }
    };

    speechRef.current = createSpeechInput({
      onStart: () => {
        setMode('speech');
        setStatus('Listening. Click Stop voice when you are finished.');
      },
      onTranscript: applyTranscript,
      onError: message => setStatus(message),
      onEnd: finish,
    });

    recordingRef.current = createRecordedSpeechInput({
      onStart: () => {
        setMode('recording');
        setStatus('Listening. Click Stop voice when you are finished.');
      },
      onAudio: async audio => {
        setMode('transcribing');
        setStatus('Transcribing your voice. Your email is unchanged.');
        applyTranscript(await transcribeAudio(audio));
      },
      onError: message => setStatus(message),
      onEnd: finish,
    });

    return () => {
      speechRef.current?.stop();
      recordingRef.current?.stop();
    };
  }, [onChange]);

  const toggleVoice = async () => {
    if (mode === 'speech') {
      speechRef.current?.stop();
      return;
    }
    if (mode === 'recording') {
      recordingRef.current?.stop();
      return;
    }
    if (mode !== 'idle') return;

    prefixRef.current = valueRef.current.trim();
    receivedTranscriptRef.current = false;
    setMode('starting');
    setStatus('Starting voice input...');
    if (!speechRef.current?.start()) {
      await recordingRef.current?.start();
    }
  };

  const voiceActive = mode === 'speech' || mode === 'recording';
  const voiceLabel = mode === 'transcribing'
    ? 'Transcribing'
    : mode === 'starting'
      ? 'Starting'
      : voiceActive
        ? 'Stop voice'
        : 'Voice';

  return (
    <div className="space-y-1.5">
      <div className={`rounded-lg border bg-brand-surface transition-all focus-within:border-brand-accent/40 focus-within:bg-brand-surface-2 focus-within:ring-2 focus-within:ring-brand-accent/10 ${
        voiceActive ? 'border-brand-accent/40' : 'border-brand-border'
      }`}>
        <textarea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          aria-label="Instructions for Pranan"
          placeholder={placeholder}
          className="block min-h-[68px] w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 text-xs leading-[18px] text-brand-text placeholder:text-brand-text-3/60 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <button
            type="button"
            onClick={() => { void toggleVoice(); }}
            disabled={disabled || mode === 'starting' || mode === 'transcribing'}
            aria-label={voiceActive ? 'Stop voice input' : 'Dictate Pranan instructions'}
            aria-pressed={voiceActive}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium transition-colors ${
              voiceActive
                ? 'bg-brand-accent/10 text-brand-accent'
                : 'text-brand-text-3 hover:bg-brand-surface-3 hover:text-brand-text'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {voiceLabel}
          </button>
          <span className="text-[9px] text-brand-text-3/60">Enter to draft</span>
        </div>
      </div>
      {status && (
        <p role="status" aria-live="polite" className="px-0.5 text-[10px] leading-relaxed text-brand-text-3">
          {status}
        </p>
      )}
    </div>
  );
}
