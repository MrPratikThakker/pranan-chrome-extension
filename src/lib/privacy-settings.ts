/**
 * Opt-in switches for anything the extension would otherwise send without a
 * click.
 *
 * Audit EXT-02 / XP-05: a background grammar monitor sent every unsent Gmail,
 * Slack and LinkedIn draft to the server after a short typing pause, with no
 * user action and no disclosure. Audit EXT-03: LinkedIn comments were stored
 * as voice samples the same way. Both are now off until the user turns them on
 * in the popup, and the service worker refuses the request when the switch is
 * off, so a stale content script cannot send anything either.
 *
 * These are preferences, not secrets, so they live in chrome.storage.local
 * where content scripts can read them to avoid sending a doomed message.
 */

export interface PrivacySettings {
  /** Check grammar and tone in the background while the user types. */
  passiveGrammarChecks: boolean;
  /** Save LinkedIn comments the user posts as voice samples. */
  linkedinVoiceCapture: boolean;
}

export const PRIVACY_SETTINGS_KEY = 'privacySettings';

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = Object.freeze({
  passiveGrammarChecks: false,
  linkedinVoiceCapture: false,
});

/** Anything that is not literally `true` stays off. */
export function normalizePrivacySettings(raw: unknown): PrivacySettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PrivacySettings, unknown>>;
  return {
    passiveGrammarChecks: value.passiveGrammarChecks === true,
    linkedinVoiceCapture: value.linkedinVoiceCapture === true,
  };
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  try {
    const stored = await chrome.storage.local.get(PRIVACY_SETTINGS_KEY);
    return normalizePrivacySettings(stored?.[PRIVACY_SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
}

export async function setPrivacySetting<K extends keyof PrivacySettings>(
  key: K,
  value: PrivacySettings[K],
): Promise<PrivacySettings> {
  const next = { ...(await getPrivacySettings()), [key]: value === true };
  await chrome.storage.local.set({ [PRIVACY_SETTINGS_KEY]: next });
  return next;
}

/**
 * Cheap synchronous check for content scripts that fire often (every typing
 * pause). Starts off, reads the stored value once, and follows later changes.
 */
export function watchPrivacySettings(): { current(): PrivacySettings; stop(): void } {
  let current: PrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
  let stopped = false;
  void getPrivacySettings().then((settings) => { if (!stopped) current = settings; });
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[PRIVACY_SETTINGS_KEY]) return;
    current = normalizePrivacySettings(changes[PRIVACY_SETTINGS_KEY].newValue);
  };
  try { chrome.storage.onChanged.addListener(listener); } catch { /* storage unavailable */ }
  return {
    current: () => current,
    stop: () => {
      stopped = true;
      try { chrome.storage.onChanged.removeListener(listener); } catch { /* pass */ }
    },
  };
}
