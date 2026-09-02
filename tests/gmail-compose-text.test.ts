import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readGmailComposeText } from '../src/lib/gmail-compose-text';

describe('Gmail revision context', () => {
  it('reads this draft without quoted history or another compose', () => {
    const compose = document.createElement('div');
    compose.innerHTML = '<div contenteditable="true"><div>Hi Alex,</div><div>By Friday, can you confirm scope, timing and cost?</div><div><div class="gmail_quote">Old quoted mail</div></div></div><div contenteditable="true">Other compose</div>';
    const body = compose.firstElementChild as HTMLElement;
    const before = compose.innerHTML;
    const text = readGmailComposeText(body);
    expect(text).toContain('Hi Alex,');
    expect(text).toContain('By Friday, can you confirm scope, timing and cost?');
    expect(text).not.toContain('Old quoted mail');
    expect(text).not.toContain('Other compose');
    expect(compose.innerHTML).toBe(before);
  });
  it('keeps ordinary user-written blockquotes and line breaks', () => {
    const body = document.createElement('div');
    body.innerHTML = 'First<br>Second<blockquote>Customer phrase</blockquote><p>Third&nbsp;line</p>';
    expect(readGmailComposeText(body)).toBe('First\nSecond\nCustomer phrase\n\nThird line');
  });
  it('does not include hidden UI, script text, or empty editor placeholders', () => {
    const body = document.createElement('div');
    body.innerHTML = '<div><br></div><span hidden>Ignore</span><span aria-hidden="true">Ignore</span><script>Ignore</script>';
    expect(readGmailComposeText(body)).toBe('');
  });
  it('does not silently truncate long content', () => {
    const body = document.createElement('div');
    body.textContent = 'a'.repeat(12_001);
    expect(readGmailComposeText(body)).toHaveLength(12_001);
  });
  it('propagates current draft through the worker to the API', () => {
    const gmail = readFileSync('src/content/gmail/index.ts', 'utf8');
    const worker = readFileSync('src/background/service-worker.ts', 'utf8');
    expect(gmail).toContain('userPrompt ? readGmailComposeText(editableBody)');
    expect(gmail).toContain('currentDraft.length > MAX_COMPOSE_DRAFT_CHARS');
    expect(gmail).toContain('currentDraft: currentDraft || undefined');
    expect(worker).toContain('currentDraft: inlinePayload.currentDraft || undefined');
  });
});
