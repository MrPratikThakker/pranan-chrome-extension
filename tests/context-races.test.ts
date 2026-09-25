import { beforeEach, it, expect, vi } from 'vitest';
import { useStore } from '../src/hooks/useStore';
import * as api from '../src/lib/api-client';
import type { ComposeContext } from '../src/types';
vi.mock('../src/lib/api-client', () => ({ getContactContext: vi.fn(), generateDraft: vi.fn(), rewriteText: vi.fn(), checkGrammar: vi.fn() }));
vi.mock('../src/lib/token-store', () => ({ clearAuthTokens: vi.fn(async () => {}) }));
const ctx = (email: string): ComposeContext => ({ platform: 'gmail', recipientEmail: email, recipientName: null, threadId: email, messageToReplyTo: null, channelName: null, isDM: false, selectedText: null, sourceTabId: 10 });
const deferred = <T>() => { let resolve!: (x: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).chrome = { storage: { local: { set: vi.fn(async () => {}) } } };
  useStore.getState().setComposeContext(null);
  useStore.setState({ isAuthenticated: true, viewMode: 'context', interactionCount: 0 });
});
it('late contact A cannot replace contact B or navigate away from a draft', async () => {
  const a = deferred<any>(); const b = deferred<any>();
  vi.mocked(api.getContactContext).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  useStore.getState().setComposeContext(ctx('a@example.com'));
  useStore.getState().setComposeContext(ctx('b@example.com'));
  useStore.setState({ viewMode: 'draft' });
  b.resolve({ tier: 'B' }); await b.promise;
  a.resolve({ tier: 'A' }); await a.promise;
  expect(useStore.getState().contactContext?.tier).toBe('B');
  expect(useStore.getState().viewMode).toBe('draft');
});
it('discarded responses cannot resurrect a draft after context changes', async () => {
  const release = deferred<void>();
  vi.mocked(api.generateDraft).mockImplementation(async () => { await release.promise; return { draft: 'For old recipient', confidence: 1, voiceMatch: 1, alternativeTones: [] }; });
  const request = useStore.getState().requestDraft({ platform: 'gmail' });
  useStore.getState().setComposeContext(ctx('new@example.com'));
  release.resolve(); await request;
  expect(useStore.getState().currentDraft).toBeNull();
  expect(useStore.getState().streamingDraftText).toBe('');
  expect(useStore.getState().isDraftLoading).toBe(false);
});
it('switching same-platform tabs clears the prior compose and draft', () => {
  useStore.getState().setComposeContext(ctx('a@example.com'));
  useStore.setState({ currentDraft: { draft: 'for A', confidence: 0, voiceMatch: 0, alternativeTones: [] } });
  useStore.getState().handleMessage({ type: 'PLATFORM_DETECTED', payload: { platform: 'gmail', tabId: 20 } });
  expect(useStore.getState().composeContext).toBeNull();
  expect(useStore.getState().currentDraft).toBeNull();
});
it('closing or changing a different compose does not reset the active draft', () => {
  useStore.getState().setComposeContext({ ...ctx('b@example.com'), editorId: 'b' });
  useStore.setState({ currentDraft: { draft: 'Keep B', confidence: 0, voiceMatch: 0, alternativeTones: [] } });
  useStore.getState().handleMessage({ type: 'COMPOSE_CLOSED', payload: { editorId: 'a', sourceTabId: 10 } });
  useStore.getState().handleMessage({ type: 'RECIPIENT_CHANGED', payload: { editorId: 'a', recipientEmail: 'new@example.com' } });
  expect(useStore.getState().currentDraft?.draft).toBe('Keep B');
  expect(useStore.getState().composeContext?.recipientEmail).toBe('b@example.com');
});
it('keeps the last draft and does not start another generation after a network failure', async () => {
  useStore.setState({ currentDraft: { draft: 'Keep my work', confidence: 0, voiceMatch: 0, alternativeTones: [] } });
  vi.mocked(api.generateDraft).mockRejectedValue(new TypeError('Network unavailable'));
  await useStore.getState().requestDraft({ platform: 'gmail' });
  // Exactly one charged generation: no silent second attempt after an uncertain failure.
  expect(api.generateDraft).toHaveBeenCalledTimes(1);
  expect(useStore.getState().currentDraft?.draft).toBe('Keep my work');
  expect(useStore.getState().isDraftLoading).toBe(false);
});
it('stopping a delayed request preserves the last draft and rejects late chunks', async () => {
  const release = deferred<void>();
  useStore.setState({ currentDraft: { draft: 'Keep my work', confidence: 0, voiceMatch: 0, alternativeTones: [] } });
  vi.mocked(api.generateDraft).mockImplementation(async () => { await release.promise; return { draft: 'Too late', confidence: 1, voiceMatch: 1, alternativeTones: [] }; });
  const pending = useStore.getState().requestDraft({ platform: 'gmail' });
  useStore.getState().cancelDraft(); release.resolve(); await pending;
  expect(useStore.getState().currentDraft?.draft).toBe('Keep my work');
  expect(useStore.getState().isDraftLoading).toBe(false);
});

it('shows the upgrade path when the plan quota is used up (XP-09)', async () => {
  const quota = Object.assign(new Error('Draft quota exceeded for this billing period'), { status: 402, code: 'QUOTA_EXCEEDED', upgradeUrl: 'https://app.pranan.ai/settings/billing' });
  vi.mocked(api.generateDraft).mockRejectedValue(quota);
  await useStore.getState().requestDraft({ platform: 'gmail' });
  expect(useStore.getState().error).toMatch(/app\.pranan\.ai\/settings\/billing/);
  expect(useStore.getState().isDraftLoading).toBe(false);
});
it('lists opt-in grammar suggestions for the active compose only (EXT-02)', () => {
  useStore.getState().setComposeContext(ctx('a@example.com'));
  const suggestion = { id: 's1', original: 'teh', suggestion: 'the', type: 'grammar', reason: 'Spelling' };
  useStore.getState().handleMessage({ type: 'GRAMMAR_SUGGESTIONS', payload: { suggestions: [suggestion, { bad: true }], sourceTabId: 10 } } as never);
  expect(useStore.getState().inlineSuggestions).toEqual([suggestion]);
  useStore.getState().handleMessage({ type: 'GRAMMAR_SUGGESTIONS', payload: { suggestions: [], sourceTabId: 99 } } as never);
  expect(useStore.getState().inlineSuggestions).toEqual([suggestion]);
  useStore.getState().setComposeContext(ctx('b@example.com'));
  expect(useStore.getState().inlineSuggestions).toEqual([]);
});
it('keeps the instruction, tone and typed text on the side-panel draft path (EXT-01)', async () => {
  vi.mocked(api.generateDraft).mockResolvedValue({ draft: 'ok', confidence: 1, voiceMatch: 1, alternativeTones: [] });
  (globalThis as any).chrome.tabs = { query: vi.fn(), sendMessage: vi.fn() };
  useStore.getState().handleMessage({ type: 'INLINE_DRAFT_REQUEST', payload: { platform: 'linkedin', recipientName: 'Sam', userPrompt: 'decline politely', tone: 'warm', currentText: 'Hi Sam,' } } as never);
  await Promise.resolve(); await Promise.resolve();
  expect(api.generateDraft).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'decline politely', tone: 'warm', currentDraft: 'Hi Sam,' }), expect.anything());
});
