import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../src/content/slack/index.ts'),
  'utf8',
);

describe('Slack editor binding', () => {
  it('binds prompt-bar draft requests to the originating Slack editor', () => {
    const triggerDraft = source.match(/const triggerDraft = \(\) => \{[\s\S]*?chrome\.runtime\.sendMessage\(\{[\s\S]*?\}\)\.catch/);

    expect(triggerDraft?.[0]).toContain("stampEditor(findOne<HTMLElement>('slack.messageInput'");
    expect(triggerDraft?.[0]).toMatch(/payload:\s*\{[\s\S]*editorId,/);
  });
});
