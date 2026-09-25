/**
 * Moving recorded voice audio from a content script to the service worker.
 *
 * Audit EXT-07: Gmail's recorded-audio fallback called the transcription API
 * straight from the content script. A content-script fetch runs with the
 * page's origin (mail.google.com), so the server's CORS policy rejected it
 * and the user saw "Failed to fetch". Runtime messages carry JSON only, so
 * the audio travels as base64 and the worker rebuilds the Blob and uploads it.
 */

import { safeSendMessage } from './runtime';

/** About 6 MB of audio, far above the 60-second recorder cap. */
export const MAX_AUDIO_BASE64_LENGTH = 8 * 1024 * 1024;

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Only plain audio MIME types are forwarded; anything else becomes webm. */
export function safeAudioMimeType(value: unknown): string {
  return typeof value === 'string' && /^audio\/[\w.+-]+(;\s*codecs=[\w.+-]+)?$/i.test(value) ? value : 'audio/webm';
}

/** Content-script side: ask the service worker to transcribe the recording. */
export async function transcribeViaWorker(audio: Blob): Promise<string> {
  const payload = { audio: await blobToBase64(audio), mimeType: safeAudioMimeType(audio.type) };
  if (payload.audio.length > MAX_AUDIO_BASE64_LENGTH) {
    throw new Error('That recording is too long. Try a shorter one.');
  }
  const reply = await safeSendMessage<{ text?: string; error?: string }>({ type: 'TRANSCRIBE_AUDIO', payload });
  if (!reply) throw new Error('Could not reach Pranan. Reload this tab and try again.');
  const text = typeof reply.text === 'string' ? reply.text.trim() : '';
  if (!text) throw new Error(reply.error || 'No speech was detected.');
  return text;
}
