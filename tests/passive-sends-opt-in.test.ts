/**
 * Audit EXT-02 / XP-05 and EXT-03: nothing the user types is sent in the
 * background, and no LinkedIn comment is stored, until the user opts in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorage } from './helpers/chrome-storage';

let env: ReturnType<typeof installChromeStorage>;

beforeEach(() => {
  vi.useFakeTimers();
  env = installChromeStorage();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: env.storage,
    runtime: { id: 'ext', sendMessage: vi.fn(async () => ({ ok: true })) },
  };
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

function typeInto(el: HTMLElement, text: string) {
  el.textContent = text;
  el.dispatchEvent(new Event('input'));
}

describe('privacy settings', () => {
  it('default to off, and only a literal true turns a switch on', async () => {
    const { getPrivacySettings, normalizePrivacySettings } = await import('../src/lib/privacy-settings');
    await expect(getPrivacySettings()).resolves.toEqual({ passiveGrammarChecks: false, linkedinVoiceCapture: false });
    expect(normalizePrivacySettings({ passiveGrammarChecks: 'yes', linkedinVoiceCapture: 1 })).toEqual({ passiveGrammarChecks: false, linkedinVoiceCapture: false });
  });

  it('persist a change', async () => {
    const { setPrivacySetting, getPrivacySettings } = await import('../src/lib/privacy-settings');
    await setPrivacySetting('passiveGrammarChecks', true);
    await expect(getPrivacySettings()).resolves.toEqual({ passiveGrammarChecks: true, linkedinVoiceCapture: false });
  });
});

describe('background grammar monitor', () => {
  it('sends nothing while the switch is off (the default)', async () => {
    const { createSuggestionMonitor } = await import('../src/content/shared/inline-suggestions');
    const el = document.createElement('div');
    document.body.append(el);
    const check = vi.fn(async () => []);
    createSuggestionMonitor({ element: el, onCheckRequested: check, minLength: 5, debounceMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    typeInto(el, 'this is a private unsent draft');
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).not.toHaveBeenCalled();
  });

  it('checks after a pause once the user has opted in', async () => {
    const { createSuggestionMonitor } = await import('../src/content/shared/inline-suggestions');
    const el = document.createElement('div');
    document.body.append(el);
    const check = vi.fn(async () => []);
    createSuggestionMonitor({ element: el, onCheckRequested: check, minLength: 5, debounceMs: 100, isEnabled: () => true });
    typeInto(el, 'this draft may be checked');
    await vi.advanceTimersByTimeAsync(150);
    expect(check).toHaveBeenCalledWith('this draft may be checked');
  });

  it('follows the stored setting live', async () => {
    env.local.data.privacySettings = { passiveGrammarChecks: true };
    const { watchPrivacySettings } = await import('../src/lib/privacy-settings');
    const watcher = watchPrivacySettings();
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.current().passiveGrammarChecks).toBe(true);
    for (const listener of env.listeners) listener({ privacySettings: { newValue: { passiveGrammarChecks: false } } }, 'local');
    expect(watcher.current().passiveGrammarChecks).toBe(false);
  });
});

describe('LinkedIn comment capture confirmation', () => {
  it('counts a comment as posted only once the editor is cleared and the text shows in the thread', async () => {
    const { isConfirmedCommentPost } = await import('../src/content/linkedin/comment-capture');
    const scope = document.createElement('div');
    const editor = document.createElement('div');
    scope.append(editor);
    document.body.append(scope);
    const text = 'Congratulations on the launch, the onboarding flow looks great.';

    // Enter pressed, nothing posted: the text is still in the editor.
    expect(isConfirmedCommentPost({ editor, scope, text, editorText: text })).toBe(false);
    // Editor cleared but the comment never appeared (discarded).
    expect(isConfirmedCommentPost({ editor, scope, text, editorText: '' })).toBe(false);
    // Posted: editor cleared and the comment is rendered in the thread.
    const posted = document.createElement('p');
    posted.textContent = text;
    scope.append(posted);
    expect(isConfirmedCommentPost({ editor, scope, text, editorText: '' })).toBe(true);
  });
});
