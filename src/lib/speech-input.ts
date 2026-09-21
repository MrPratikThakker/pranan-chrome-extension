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
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  }) => void) | null;
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
  // Chrome keeps prior final results in every later result event. Store each
  // final segment by its result index so a later update replaces a segment
  // instead of appending the same sentence again.
  let finalSegments: string[] = [];
  let sessionOpen = false;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  const clearStartupTimer = () => {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
  };
  recognition.onstart = () => {
    clearStartupTimer();
    if (sessionOpen) callbacks.onStart();
  };
  recognition.onresult = event => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const text = (result[0]?.transcript || '').trim();
      if (result.isFinal) {
        finalSegments[index] = text;
      } else {
        interim += text;
      }
    }
    const completed = finalSegments.filter(Boolean).join(' ').trim();
    callbacks.onTranscript([completed, interim.trim()].filter(Boolean).join(' ').trim());
  };
  recognition.onerror = event => {
    clearStartupTimer();
    if (!sessionOpen) return;
    sessionOpen = false;
    callbacks.onError(
      event.error === 'not-allowed'
        ? 'Microphone access was not allowed. You can keep typing your instructions.'
        : 'Voice input stopped. Your transcript is preserved and ready to edit.',
    );
    callbacks.onEnd();
  };
  recognition.onend = () => {
    clearStartupTimer();
    if (!sessionOpen) return;
    sessionOpen = false;
    callbacks.onEnd();
  };
  return {
    start: () => {
      try {
        sessionOpen = true;
        finalSegments = [];
        startupTimer = setTimeout(() => {
          if (!sessionOpen) return;
          sessionOpen = false;
          try { recognition.stop(); } catch { /* unavailable */ }
          callbacks.onError('Microphone did not start. Check Chrome microphone access, then try again.');
          callbacks.onEnd();
        }, 4_000);
        recognition.start();
        return true;
      } catch {
        clearStartupTimer();
        sessionOpen = false;
        callbacks.onError('Voice input is already active or unavailable.');
        return false;
      }
    },
    stop: () => { try { recognition.stop(); } catch { /* already stopped */ } },
  };
}
