import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: vi.fn(async () => ({})), remove: vi.fn(), set: vi.fn() } },
    runtime: { sendMessage: vi.fn() },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

it('uploads recorded audio as multipart without forcing a JSON content type', async () => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ text: 'Confirm Friday.' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  const { transcribeAudio } = await import('../src/lib/api-client');

  await expect(transcribeAudio(new Blob(['voice'], { type: 'audio/webm' }))).resolves.toBe('Confirm Friday.');
  const init = fetchSpy.mock.calls[0][1] as RequestInit;
  expect(init.body).toBeInstanceOf(FormData);
  expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  expect(init.credentials).toBe('include');
});
