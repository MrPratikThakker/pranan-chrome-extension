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
}

export function VoicePromptField({ value, onChange, onSubmit, disabled = false }: Props) {
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
      <div className="flex items-stretch gap-2">
        <textarea
          rows={2}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          aria-label="Instructions for Pranan"
          placeholder="Tell Pranan what the reply should accomplish"
          className="min-h-[46px] min-w-0 flex-1 resize-none text-xs leading-[17px] px-3 py-1.5 rounded-md border border-brand-border bg-brand-surface text-brand-text placeholder:text-brand-text-3/60 focus:outline-none focus:border-brand-accent/40 focus:bg-brand-surface-2 transition-all"
        />
        <button
          type="button"
          onClick={() => { void toggleVoice(); }}
          disabled={disabled || mode === 'starting' || mode === 'transcribing'}
          aria-label={voiceActive ? 'Stop voice input' : 'Dictate Pranan instructions'}
          aria-pressed={voiceActive}
          className={`min-h-[46px] flex-none rounded-md border px-2.5 text-[11px] font-medium transition-colors ${
            voiceActive
              ? 'border-brand-accent/40 bg-brand-accent/10 text-brand-accent'
              : 'border-brand-border bg-brand-surface text-brand-text-2 hover:border-brand-border-strong hover:text-brand-text'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {voiceLabel}
        </button>
      </div>
      {status && (
        <p role="status" aria-live="polite" className="px-0.5 text-[10px] leading-relaxed text-brand-text-3">
          {status}
        </p>
      )}
    </div>
  );
}
