import { describe, it, expect } from 'vitest';
import { draftErrorAction, draftErrorMessage } from '../src/lib/draft-error-message';

describe('draftErrorMessage', () => {
  it('surfaces the rate limit on 429 (the heavy-use case)', () => {
    expect(draftErrorMessage({ status: 429 })).toMatch(/limit.*wait|wait.*try again/i);
  });
  it('tells the user to re-auth on 401', () => {
    expect(draftErrorMessage({ status: 401 })).toMatch(/session expired|sign back in/i);
  });
  it('explains a 503 AI outage', () => {
    expect(draftErrorMessage({ status: 503 })).toMatch(/unavailable/i);
  });
  // Measured on Pratik's inbox 29 Jul, v0.8.39: Generate ran, nothing came
  // back, and the bar sat on "Generating..." until its own 30s reset fired with
  // "This took longer than expected. Check you're signed in" — while the
  // session was in fact valid and the API answered a direct call in 4.4s. A
  // stalled request has to name itself, or every stall reads as a login problem.
  it('names a stalled request instead of blaming the session', () => {
    const abort = new Error('The operation was aborted.');
    abort.name = 'TimeoutError';
    expect(draftErrorMessage(abort)).toMatch(/took too long|timed out/i);
    expect(draftErrorMessage(abort)).not.toMatch(/sign|session/i);

    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    expect(draftErrorMessage(aborted)).toMatch(/took too long|timed out/i);
  });

  it('falls back to the generic message for unknown errors', () => {
    expect(draftErrorMessage(new Error('boom'))).toBe('Draft failed to generate. Try again.');
    expect(draftErrorMessage(undefined)).toBe('Draft failed to generate. Try again.');
  });

  it('offers the upgrade path when the plan quota is used up (402, XP-09)', () => {
    expect(draftErrorMessage({ status: 402, upgradeUrl: 'https://app.pranan.ai/settings/billing' })).toMatch(/app\.pranan\.ai\/settings\/billing/);
    expect(draftErrorMessage({ status: 402 })).toMatch(/upgrade/i);
  });

  it('tells a daily-budget 429 apart from a burst limit (XP-31)', () => {
    expect(draftErrorMessage({ status: 429, code: 'DAILY_BUDGET' })).toMatch(/midnight UTC/);
    expect(draftErrorMessage({ status: 429, code: 'AI_ERROR' })).toMatch(/busy/i);
    expect(draftErrorMessage({ status: 429, code: 'RATE_LIMITED' })).toMatch(/couple of minutes/);
  });

  it('does not call a refresh blip a sign-out (EXT-08)', () => {
    const msg = draftErrorMessage({ status: 503, code: 'AUTH_REFRESH_UNAVAILABLE' });
    expect(msg).toMatch(/still signed in/i);
  });
});


describe('draftErrorAction', () => {
  it('gives the draft limit a real upgrade link to billing', () => {
    const action = draftErrorAction({ status: 402 });
    expect(action).toMatchObject({ kind: 'upgrade', url: 'https://app.pranan.ai/settings/billing' });
    expect(action?.label).toBe('Upgrade plan');
  });

  it('uses the link the server sent when it is on the Pranan app', () => {
    expect(draftErrorAction({ status: 402, upgradeUrl: 'https://app.pranan.ai/settings/billing?plan=pro' })?.url)
      .toBe('https://app.pranan.ai/settings/billing?plan=pro');
  });

  it('never links anywhere but the Pranan app', () => {
    for (const upgradeUrl of ['https://evil.example/settings/billing', 'https://app.pranan.ai.evil.example/x', 'javascript:alert(1)', '//evil.example', 42]) {
      expect(draftErrorAction({ status: 402, upgradeUrl })?.url).toBe('https://app.pranan.ai/settings/billing');
    }
  });

  it('does not repeat the address in the copy shown beside the link', () => {
    const action = draftErrorAction({ status: 402 });
    expect(action?.message).toMatch(/upgrade/i);
    expect(action?.message).not.toMatch(/pranan\.ai/);
  });

  it('has no action for failures with nothing to open', () => {
    for (const err of [{ status: 429 }, { status: 503 }, { status: 409 }, new Error('boom'), undefined]) {
      expect(draftErrorAction(err)).toBeNull();
    }
  });
});
