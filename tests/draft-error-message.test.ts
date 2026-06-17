import { describe, it, expect } from 'vitest';
import { draftErrorMessage } from '../src/lib/draft-error-message';

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
  it('falls back to the generic message for unknown errors', () => {
    expect(draftErrorMessage(new Error('boom'))).toBe('Draft failed to generate. Try again.');
    expect(draftErrorMessage(undefined)).toBe('Draft failed to generate. Try again.');
  });
});
