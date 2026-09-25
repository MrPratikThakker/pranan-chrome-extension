/** Audit EXT-21: one live copy of a content script per page. */
import { describe, expect, it } from 'vitest';
import { claimContentScriptInstance } from '../src/content/shared/instance-guard';

describe('claimContentScriptInstance', () => {
  it('lets the first copy run and stops a second live copy', () => {
    const win = {} as Window;
    expect(claimContentScriptInstance('gmail', { alive: () => true }, win)).toBe(true);
    expect(claimContentScriptInstance('gmail', { alive: () => true }, win)).toBe(false);
  });

  it('lets a new copy take over from one orphaned by an extension update', () => {
    const win = {} as Window;
    expect(claimContentScriptInstance('gmail', { alive: () => false }, win)).toBe(true);
    expect(claimContentScriptInstance('gmail', { alive: () => true }, win)).toBe(true);
  });

  it('treats a probe that throws as dead', () => {
    const win = {} as Window;
    claimContentScriptInstance('gmail', { alive: () => { throw new Error('Extension context invalidated.'); } }, win);
    expect(claimContentScriptInstance('gmail', { alive: () => true }, win)).toBe(true);
  });

  it('keys copies by script', () => {
    const win = {} as Window;
    expect(claimContentScriptInstance('gmail', { alive: () => true }, win)).toBe(true);
    expect(claimContentScriptInstance('slack', { alive: () => true }, win)).toBe(true);
  });
});
