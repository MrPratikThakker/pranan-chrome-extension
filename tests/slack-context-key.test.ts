/**
 * Regression: Slack prompt-bar recipient off-by-one (QA 2026-06-12).
 *
 * Slack is an SPA; on conversation switch the message input re-renders before
 * the header DOM updates, so the first inject can capture the PREVIOUS
 * conversation's recipient. The old guard returned early whenever any Pranan
 * bar existed, freezing the stale bar — every conversation then showed the
 * previous one's recipient. The fix stamps each bar with a context key and
 * rebuilds when the live conversation no longer matches. Lock that logic.
 */
import { describe, it, expect } from 'vitest';
import { slackContextKey, slackBarIsStale } from '../src/content/slack/context-key';

describe('slackContextKey', () => {
  it('keys a DM by recipient name', () => {
    expect(slackContextKey(true, 'Gatha Dubey', null)).toBe('dm:Gatha Dubey');
  });

  it('keys a channel by channel name', () => {
    expect(slackContextKey(false, null, 'marketing-control-room')).toBe('ch:marketing-control-room');
  });

  it('distinguishes a 1:1 DM from a group DM with the same person in it', () => {
    const oneOnOne = slackContextKey(true, 'Gatha Dubey', null);
    const group = slackContextKey(true, 'Disha Shukla, Gatha Dubey, Marshall Fernandes', null);
    expect(oneOnOne).not.toBe(group);
  });

  it('is stable for the same conversation (no churn)', () => {
    expect(slackContextKey(true, 'Disha Shukla', null))
      .toBe(slackContextKey(true, 'Disha Shukla', null));
  });
});

describe('slackBarIsStale', () => {
  it('flags a bar built for a different recipient as stale (the off-by-one case)', () => {
    // In Disha's DM, but the bar still carries Gatha's key -> must rebuild.
    expect(slackBarIsStale('dm:Gatha Dubey', slackContextKey(true, 'Disha Shukla', null))).toBe(true);
  });

  it('flags the group-DM -> 1:1 transition as stale', () => {
    const groupKey = slackContextKey(true, 'Disha Shukla, Gatha Dubey, Marshall Fernandes', null);
    const dmKey = slackContextKey(true, 'Gatha Dubey', null);
    expect(slackBarIsStale(groupKey, dmKey)).toBe(true);
  });

  it('keeps a bar whose key still matches the live conversation', () => {
    expect(slackBarIsStale('dm:Disha Shukla', slackContextKey(true, 'Disha Shukla', null))).toBe(false);
  });

  it('treats a never-stamped bar (null key) as stale', () => {
    expect(slackBarIsStale(null, slackContextKey(true, 'Disha Shukla', null))).toBe(true);
  });
});
