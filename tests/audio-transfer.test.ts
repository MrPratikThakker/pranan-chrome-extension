/**
 * Audit EXT-07: recorded voice goes to the service worker, which calls the
 * transcription API. A content-script fetch runs with the page's origin and
 * the server's CORS policy rejected it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { base64ToBlob, blobToBase64, safeAudioMimeType, transcribeViaWorker } from '../src/lib/audio-transfer';

afterEach(() => { vi.restoreAllMocks(); });

describe('audio transfer', () => {
  it('round-trips audio bytes through base64', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const encoded = await blobToBase64(new Blob([bytes], { type: 'audio/webm' }));
    const decoded = new Uint8Array(await base64ToBlob(encoded, 'audio/webm').arrayBuffer());
    expect(decoded).toEqual(bytes);
  });

  it('only forwards plain audio MIME types', () => {
    expect(safeAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
    expect(safeAudioMimeType('text/html')).toBe('audio/webm');
    expect(safeAudioMimeType(undefined)).toBe('audio/webm');
  });

  it('asks the worker to transcribe and returns its text', async () => {
    const sendMessage = vi.fn(async () => ({ text: ' Confirm Friday. ' }));
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'ext', sendMessage } };
    await expect(transcribeViaWorker(new Blob(['voice'], { type: 'audio/ogg' }))).resolves.toBe('Confirm Friday.');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TRANSCRIBE_AUDIO', payload: { audio: btoa('voice'), mimeType: 'audio/ogg' } });
  });

  it('surfaces the worker\'s error', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'ext', sendMessage: vi.fn(async () => ({ error: 'No speech was detected.' })) } };
    await expect(transcribeViaWorker(new Blob(['x']))).rejects.toThrow('No speech was detected.');
  });

  it('Gmail no longer calls the transcription API itself', () => {
    const gmail = readFileSync('src/content/gmail/index.ts', 'utf8');
    expect(gmail).not.toContain("from '@/lib/api-client'");
    expect(gmail).toContain('transcribeViaWorker(audio)');
  });
});
