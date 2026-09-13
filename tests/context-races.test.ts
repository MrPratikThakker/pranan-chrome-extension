import { beforeEach, it, expect, vi } from 'vitest';
import { useStore } from '../src/hooks/useStore';
import * as api from '../src/lib/api-client';
import type { ComposeContext } from '../src/types';
vi.mock('../src/lib/api-client', () => ({ getContactContext: vi.fn(), streamDraft: vi.fn(), generateDraft: vi.fn(), rewriteText: vi.fn(), checkGrammar: vi.fn() }));
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
it('discarded streaming responses cannot resurrect a draft after context changes', async () => {
  const release = deferred<void>();
  vi.mocked(api.streamDraft).mockImplementation(async function* () { await release.promise; yield { type: 'chunk', text: 'For old recipient' }; });
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
  vi.mocked(api.streamDraft).mockImplementation(async function* () { throw new TypeError('Network unavailable'); });
  await useStore.getState().requestDraft({ platform: 'gmail' });
  expect(api.generateDraft).not.toHaveBeenCalled();
  expect(useStore.getState().currentDraft?.draft).toBe('Keep my work');
  expect(useStore.getState().isDraftLoading).toBe(false);
});
it('stopping a delayed request preserves the last draft and rejects late chunks', async () => {
  const release = deferred<void>();
  useStore.setState({ currentDraft: { draft: 'Keep my work', confidence: 0, voiceMatch: 0, alternativeTones: [] } });
  vi.mocked(api.streamDraft).mockImplementation(async function* () { await release.promise; yield { type: 'chunk', text: 'Too late' }; });
  const pending = useStore.getState().requestDraft({ platform: 'gmail' });
  useStore.getState().cancelDraft(); release.resolve(); await pending;
  expect(useStore.getState().currentDraft?.draft).toBe('Keep my work');
  expect(useStore.getState().isDraftLoading).toBe(false);
});
