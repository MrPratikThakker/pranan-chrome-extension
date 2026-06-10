/**
 * Regression: generateDraft must normalize the server's skip shape.
 *
 * The /draft endpoint returns an intentional skip as HTTP 200 with body
 * { draft: null, skipped: true, reason, message }. The rest of the extension
 * (SW INLINE_DRAFT_REQUEST handler -> DRAFT_SKIPPED -> Gmail content notice)
 * reads skipReason / skipMessage. The streaming path mapped these; the
 * non-streaming generateDraft path (used by the one-tap inline bar) did NOT,
 * so the specific reason ("This email is addressed to Jigar, you are only
 * copied...") was dropped and the UI fell back to a generic "Draft skipped."
 * an intentional skip looked like a silent no-op. Lock the mapping here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let originalFetch: typeof globalThis.fetch;

function makeSkipFetch(body: Record<string, unknown>) {
  const text = JSON.stringify(body);
  return vi.fn(async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response));
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => {}),
        set: vi.fn(async () => {}),
      },
    },
    runtime: { sendMessage: vi.fn() },
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('generateDraft skip-field normalization', () => {
  it('maps server reason/message -> skipReason/skipMessage on a skip', async () => {
    globalThis.fetch = makeSkipFetch({
      draft: null,
      skipped: true,
      reason: 'addressed_to_other',
      message: 'This email is addressed to Jigar, and you are only copied. Default is to stay out of it. Add a prompt or pick an intent to draft anyway.',
    }) as unknown as typeof globalThis.fetch;

    const { generateDraft } = await import('../src/lib/api-client');
    const res = await generateDraft({ platform: 'gmail' } as never);

    expect(res.skipped).toBe(true);
    expect(res.skipReason).toBe('addressed_to_other');
    expect(res.skipMessage).toContain('addressed to Jigar');
    expect(res.skipMessage).toContain('draft anyway');
  });

  it('does not clobber skipReason/skipMessage if the server already sent them', async () => {
    globalThis.fetch = makeSkipFetch({
      draft: null,
      skipped: true,
      skipReason: 'cold_prospect_silence',
      skipMessage: 'Cold sender, staying silent.',
    }) as unknown as typeof globalThis.fetch;

    const { generateDraft } = await import('../src/lib/api-client');
    const res = await generateDraft({ platform: 'gmail' } as never);

    expect(res.skipReason).toBe('cold_prospect_silence');
    expect(res.skipMessage).toBe('Cold sender, staying silent.');
  });

  it('leaves a normal draft response untouched', async () => {
    globalThis.fetch = makeSkipFetch({
      draft: 'Hi Udit, thanks for the note.',
      confidence: 0.9,
      voiceMatch: 0.88,
      alternativeTones: [],
    }) as unknown as typeof globalThis.fetch;

    const { generateDraft } = await import('../src/lib/api-client');
    const res = await generateDraft({ platform: 'gmail' } as never);

    expect(res.skipped).toBeFalsy();
    expect(res.draft).toContain('Hi Udit');
  });
});
