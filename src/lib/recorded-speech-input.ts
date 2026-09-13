export interface RecordedSpeechCallbacks {
  onStart(): void;
  onAudio(audio: Blob): Promise<void> | void;
  onError(message: string): void;
  onEnd(): void;
}

export interface RecordedSpeechInput {
  start(): Promise<boolean>;
  stop(): void;
}

const MAX_RECORDING_MS = 60_000;

export function createRecordedSpeechInput(callbacks: RecordedSpeechCallbacks): RecordedSpeechInput {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let sessionEnded = true;

  const release = () => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    recorder = null;
  };

  return {
    async start() {
      if (recorder && recorder.state !== 'inactive') return false;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        callbacks.onError('Voice input is not available in this browser. You can keep typing your instructions.');
        return false;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
          .find(type => MediaRecorder.isTypeSupported(type));
        recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
        chunks = [];
        sessionEnded = false;
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => {
          if (sessionEnded) return;
          sessionEnded = true;
          release();
          callbacks.onError('Voice recording stopped. Your typed instructions are unchanged.');
          callbacks.onEnd();
        };
        recorder.onstop = async () => {
          if (sessionEnded) return;
          sessionEnded = true;
          const mimeType = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
          const audio = new Blob(chunks, { type: mimeType });
          release();
          try {
            if (audio.size) await callbacks.onAudio(audio);
            else callbacks.onError('No speech was recorded. Try again or keep typing.');
          } catch (error) {
            callbacks.onError(error instanceof Error ? error.message : 'Voice transcription failed. Try again.');
          } finally {
            callbacks.onEnd();
          }
        };
        recorder.start(250);
        callbacks.onStart();
        timeout = setTimeout(() => recorder?.stop(), MAX_RECORDING_MS);
        return true;
      } catch (error) {
        release();
        callbacks.onError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Microphone access was not allowed. You can keep typing your instructions.'
            : 'Pranan could not start the microphone. You can keep typing your instructions.',
        );
        callbacks.onEnd();
        return false;
      }
    },
    stop() {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    },
  };
}
