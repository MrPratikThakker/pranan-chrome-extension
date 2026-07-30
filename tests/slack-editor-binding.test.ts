import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../src/content/slack/index.ts'),
  'utf8',
);

describe('Slack editor binding', () => {
  it('binds prompt-bar draft requests to the originating Slack editor', () => {
    // Matches either messaging helper. Content scripts now send through
    // safeSendMessage, which guards against the extension context being
    // invalidated by an update while the tab is open; this test cares about
    // the editor binding, not which function carries the message.
    const triggerDraft = source.match(
      /const triggerDraft = \(\) => \{[\s\S]*?(?:chrome\.runtime\.sendMessage|safeSendMessage)\([\s\S]*?\)\.catch/,
    );

    expect(triggerDraft, 'triggerDraft block not found in slack content script').toBeTruthy();

    expect(triggerDraft?.[0]).toContain("stampEditor(findOne<HTMLElement>('slack.messageInput'");
    expect(triggerDraft?.[0]).toMatch(/payload:\s*\{[\s\S]*editorId,/);
  });
});
