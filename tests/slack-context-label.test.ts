import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { slackContextLabel } from '../src/lib/slack-context-label';

describe('Slack context labels', () => {
  it.each(['New message', 'New conversation', 'Saved a moment ago', 'Saved just now', 'Saved 2 minutes ago', 'Saving...', 'Loading…', 'Drafts', 'Direct messages', '', null, undefined])('does not turn UI text %s into a name', label => {
    expect(slackContextLabel(label)).toBeNull();
  });
  it.each(['Alex', 'Alex Chen', 'Alex, Priya', 'goal26-pranan-ai-launch', 'Đặng Minh', 'New Horizons'])('preserves actual labels %s', label => {
    expect(slackContextLabel(label)).toBe(label);
  });
  it('normalizes whitespace without changing identity', () => {
    expect(slackContextLabel(' Alex\n Chen ')).toBe('Alex Chen');
  });
  it('resolves recipient and channel at click time, not from the captured mount state', () => {
    const source = readFileSync('src/content/slack/index.ts', 'utf8');
    const trigger = source.slice(source.indexOf('const triggerDraft = () =>'), source.indexOf("input.addEventListener('keydown'"));
    expect(trigger).toContain('const liveIsDM = isDirectMessage()');
    expect(trigger).toContain('liveIsDM ? getDMRecipient() : null');
    expect(trigger).toContain('liveIsDM ? null : getChannelName()');
    expect(trigger).toContain('recipientName: liveRecipientName');
    expect(trigger).toContain('channelName: liveChannelName');
  });
});
