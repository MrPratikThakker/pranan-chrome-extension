/** User-started dictation. Never submits a prompt or restarts a microphone. */
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => Recognition;
export function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}
export function createVoiceInstructions(options: {
  Recognition: RecognitionConstructor;
  language: string;
  onText: (text: string) => void;
  onStatus: (text: string, active: boolean) => void;
}) {
  let current: Recognition | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    const instance = current;
    current = null;
    clearTimeout(timer);
    if (instance) { instance.onresult = null; instance.onend = null; instance.onerror = null; try { instance.abort(); } catch { /* already ended */ } }
    options.onStatus('Recording stopped. Review your instructions before generating.', false);
  };
  const start = () => {
    if (current) return;
    const recognition = new options.Recognition();
    current = recognition;
    recognition.lang = options.language;
    recognition.continuous = false;
    recognition.interimResults = true;
    const seen = new Set<number>();
    let heard = false;
    recognition.onresult = event => {
      if (current !== recognition) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && !seen.has(i)) {
          seen.add(i);
          const text = result[0].transcript.trim();
          if (text) { heard = true; options.onText(text); }
        } else if (!result.isFinal) options.onStatus(`Listening: ${result[0].transcript}`, true);
      }
    };
    recognition.onerror = event => {
      if (current !== recognition) return;
      cancel();
      const errors: Record<string, string> = {
        'not-allowed': 'Microphone access was denied. You can still type your instructions.',
        'service-not-allowed': 'Dictation is unavailable in this browser. Type your instructions instead.',
        'audio-capture': 'No microphone is available. Check your microphone or type instead.',
        'no-speech': 'No speech detected. Try again or type your instructions.',
        'network': 'Dictation could not connect. Your existing instructions are preserved.',
      };
      options.onStatus(errors[event.error] || 'Dictation stopped. Your existing instructions are preserved.', false);
    };
    recognition.onend = () => {
      if (current !== recognition) return;
      current = null; clearTimeout(timer);
      options.onStatus(heard ? 'Transcript added. Review and edit it before generating.' : 'No speech captured. Try again or type your instructions.', false);
    };
    options.onStatus('Listening. Speak your instructions, then select Stop.', true);
    // Bound permission waits and capture. No background recording or retry loop.
    timer = setTimeout(cancel, 60000);
    try { recognition.start(); } catch {
      cancel(); options.onStatus('Could not start dictation. Type your instructions instead.', false);
    }
  };
  const stop = () => {
    if (!current) return;
    try { current.stop(); } catch { cancel(); }
    clearTimeout(timer);
    timer = setTimeout(cancel, 3000);
    options.onStatus('Finishing transcript...', true);
  };
  return { start, stop, cancel };
}
