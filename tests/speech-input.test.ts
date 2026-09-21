// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { createSpeechInput } from '../src/lib/speech-input';

let instance: any;
beforeEach(() => {
  class Recognition {
    continuous = false; interimResults = false; lang = '';
    onstart: any; onresult: any; onerror: any; onend: any;
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  (window as any).webkitSpeechRecognition = Recognition;
});

it('puts the editable transcript in the instruction field before generation', () => {
  const transcript = vi.fn(); const start = vi.fn(); const end = vi.fn();
  const speech = createSpeechInput({ onStart: start, onTranscript: transcript, onError: vi.fn(), onEnd: end });
  expect(speech.start()).toBe(true); expect(start).toHaveBeenCalledOnce();
  instance.onresult({ resultIndex: 0, results: [{ 0: { transcript: 'Thank them and ask for Friday' }, isFinal: true }] });
  expect(transcript).toHaveBeenLastCalledWith('Thank them and ask for Friday');
  speech.stop(); expect(end).toHaveBeenCalledOnce();
});

it('does not repeat a final sentence when Chrome reports a later transcript update', () => {
  const transcript = vi.fn();
  createSpeechInput({ onStart: vi.fn(), onTranscript: transcript, onError: vi.fn(), onEnd: vi.fn() }).start();

  instance.onresult({
    resultIndex: 0,
    results: [{ 0: { transcript: 'Please follow up with Maya' }, isFinal: true }],
  });
  instance.onresult({
    resultIndex: 1,
    results: [
      { 0: { transcript: 'Please follow up with Maya' }, isFinal: true },
      { 0: { transcript: ' tomorrow morning' }, isFinal: false },
    ],
  });
  instance.onresult({
    resultIndex: 1,
    results: [
      { 0: { transcript: 'Please follow up with Maya' }, isFinal: true },
      { 0: { transcript: ' tomorrow morning' }, isFinal: true },
    ],
  });

  expect(transcript).toHaveBeenLastCalledWith('Please follow up with Maya tomorrow morning');
  expect(transcript).not.toHaveBeenLastCalledWith('Please follow up with Maya Please follow up with Maya tomorrow morning');
});

it('keeps microphone refusal as a recoverable typed-input state', () => {
  const error = vi.fn(); const end = vi.fn(); createSpeechInput({ onStart: vi.fn(), onTranscript: vi.fn(), onError: error, onEnd: end }).start();
  instance.onerror({ error: 'not-allowed' });
  expect(error).toHaveBeenCalledWith('Microphone access was not allowed. You can keep typing your instructions.');
  expect(end).toHaveBeenCalledOnce();
  instance.onend();
  expect(end).toHaveBeenCalledOnce();
});

it('returns unavailable without throwing in unsupported browsers', () => {
  delete (window as any).webkitSpeechRecognition;
  expect(createSpeechInput({ onStart: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() }).start()).toBe(false);
});

it('recovers when Chrome never reports that the microphone started', () => {
  vi.useFakeTimers();
  class StalledRecognition {
    continuous = false; interimResults = false; lang = '';
    onstart: any; onresult: any; onerror: any; onend: any;
    start() {}
    stop() { this.onend?.(); }
  }
  (window as any).webkitSpeechRecognition = StalledRecognition;
  const error = vi.fn(); const end = vi.fn();
  createSpeechInput({ onStart: vi.fn(), onTranscript: vi.fn(), onError: error, onEnd: end }).start();
  vi.advanceTimersByTime(4_000);
  expect(error).toHaveBeenCalledWith('Microphone did not start. Check Chrome microphone access, then try again.');
  expect(end).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
