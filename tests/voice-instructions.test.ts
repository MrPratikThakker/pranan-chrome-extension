import { it, expect, vi, afterEach } from 'vitest';
import { createVoiceInstructions, type Recognition } from '../src/lib/voice-instructions';
let latest: FakeRecognition;
class FakeRecognition implements Recognition {
  lang = ''; continuous = false; interimResults = false;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { latest = this; }
}
function setup() {
  const text = vi.fn(); const status = vi.fn();
  const controller = createVoiceInstructions({ Recognition: FakeRecognition, language: 'en-IN', onText: text, onStatus: status });
  return { controller, text, status };
}
afterEach(() => vi.useRealTimers());
it('never starts until requested and appends each final result only once', () => {
  const { controller, text } = setup();
  expect(text).not.toHaveBeenCalled(); controller.start();
  expect(latest.start).toHaveBeenCalledOnce(); expect(latest.lang).toBe('en-IN');
  const result = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'A short friendly reply' } }] };
  latest.onresult?.(result); latest.onresult?.(result);
  expect(text).toHaveBeenCalledExactlyOnceWith('A short friendly reply');
  controller.cancel();
});
it('permission denial leaves typed instructions alone and offers typing', () => {
  const { controller, text, status } = setup(); controller.start();
  latest.onerror?.({ error: 'not-allowed' });
  expect(text).not.toHaveBeenCalled(); expect(latest.abort).toHaveBeenCalledOnce();
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('denied'), false);
});
it('closing prevents late results from modifying another prompt', () => {
  const { controller, text } = setup(); controller.start();
  const staleResult = latest.onresult; controller.cancel();
  staleResult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] });
  expect(text).not.toHaveBeenCalled(); expect(latest.abort).toHaveBeenCalledOnce();
});
it('stop waits for a final transcript but bounds a stalled browser', () => {
  vi.useFakeTimers(); const { controller } = setup(); controller.start(); controller.stop();
  expect(latest.stop).toHaveBeenCalledOnce(); vi.advanceTimersByTime(3000);
  expect(latest.abort).toHaveBeenCalledOnce();
});
it('bounds microphone capture and never automatically restarts', () => {
  vi.useFakeTimers(); const { controller } = setup(); controller.start();
  vi.advanceTimersByTime(60000);
  expect(latest.abort).toHaveBeenCalledOnce(); expect(latest.start).toHaveBeenCalledOnce();
});
