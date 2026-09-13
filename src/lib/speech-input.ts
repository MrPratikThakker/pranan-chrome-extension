export interface SpeechInputCallbacks {
  onStart(): void;
  onTranscript(text: string): void;
  onError(message: string): void;
  onEnd(): void;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function createSpeechInput(callbacks: SpeechInputCallbacks): { start(): boolean; stop(): void } {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!Recognition) return { start: () => false, stop: () => {} };

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = document.documentElement.lang || navigator.language || 'en-US';
  let transcript = '';
  recognition.onstart = callbacks.onStart;
  recognition.onresult = event => {
    let current = '';
    for (let index = 0; index < event.results.length; index++) {
      const result = event.results[index];
      current += result[0]?.transcript || '';
      if (result.isFinal) transcript = `${transcript} ${result[0]?.transcript || ''}`.trim();
    }
    callbacks.onTranscript((transcript || current).trim());
  };
  recognition.onerror = event => callbacks.onError(
    event.error === 'not-allowed'
      ? 'Microphone access was not allowed. You can keep typing your instructions.'
      : 'Voice input stopped. Your transcript is preserved and ready to edit.',
  );
  recognition.onend = callbacks.onEnd;
  return {
    start: () => {
      try { recognition.start(); return true; }
      catch { callbacks.onError('Voice input is already active or unavailable.'); return false; }
    },
    stop: () => { try { recognition.stop(); } catch { /* already stopped */ } },
  };
}
