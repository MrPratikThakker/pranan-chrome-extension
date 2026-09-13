// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { createRecordedSpeechInput } from '../src/lib/recorded-speech-input';

let recorder: FakeRecorder;
const track = { stop: vi.fn() };

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { recorder = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
});

it('records, releases the microphone, and returns audio for transcription', async () => {
  const onAudio = vi.fn(); const onStart = vi.fn(); const onEnd = vi.fn();
  const input = createRecordedSpeechInput({ onAudio, onStart, onEnd, onError: vi.fn() });
  expect(await input.start()).toBe(true);
  expect(onStart).toHaveBeenCalledOnce();
  input.stop();
  await vi.waitFor(() => expect(onAudio).toHaveBeenCalledOnce());
  expect(onAudio.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(onEnd).toHaveBeenCalledOnce();
});

it('keeps typed input available when microphone permission is denied', async () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) },
  });
  const onError = vi.fn(); const onEnd = vi.fn();
  const input = createRecordedSpeechInput({ onAudio: vi.fn(), onStart: vi.fn(), onEnd, onError });
  expect(await input.start()).toBe(false);
  expect(onError).toHaveBeenCalledWith('Microphone access was not allowed. You can keep typing your instructions.');
  expect(onEnd).toHaveBeenCalledOnce();
});

it('reports a recorder failure only once even if Chrome also emits stop', async () => {
  const onAudio = vi.fn(); const onError = vi.fn(); const onEnd = vi.fn();
  const input = createRecordedSpeechInput({ onAudio, onStart: vi.fn(), onEnd, onError });
  await input.start();
  recorder.onerror?.();
  recorder.onstop?.();
  expect(onError).toHaveBeenCalledOnce();
  expect(onAudio).not.toHaveBeenCalled();
  expect(onEnd).toHaveBeenCalledOnce();
});
