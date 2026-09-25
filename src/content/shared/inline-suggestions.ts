import { safeSendMessage } from '../../lib/runtime';
import { watchPrivacySettings } from '../../lib/privacy-settings';

/**
 * Grammarly-Style Inline Suggestions
 *
 * Monitors text input in compose fields, debounces grammar/tone checks,
 * and sends suggestions to the side panel for rendering.
 *
 * OFF BY DEFAULT (audit EXT-02 / XP-05). Nothing the user types is sent until
 * they turn on "Check grammar while I type" in the popup. The service worker
 * enforces the same switch, so this check only avoids a wasted message.
 *
 * Underlines are intentionally NOT rendered in contentEditable elements
 * because they are fragile and break Gmail/Slack compose behavior.
 */

export interface InlineSuggestion {
  id: string;
  range: { start: number; end: number };
  original: string;
  suggestion: string;
  type: 'grammar' | 'tone' | 'voice';
  reason: string;
}

export interface SuggestionConfig {
  /** The contentEditable element to monitor */
  element: HTMLElement;
  /** Callback to request grammar check from API */
  onCheckRequested: (text: string) => Promise<InlineSuggestion[]>;
  /** Minimum text length before checking */
  minLength?: number;
  /** Debounce interval in ms */
  debounceMs?: number;
  /** Whether background checks are allowed right now. Defaults to the user's opt-in setting. */
  isEnabled?: () => boolean;
}

let sharedSettings: ReturnType<typeof watchPrivacySettings> | null = null;
function passiveChecksEnabled(): boolean {
  sharedSettings ??= watchPrivacySettings();
  return sharedSettings.current().passiveGrammarChecks;
}

// Active suggestion tooltip (Shadow DOM isolated)
let activeTooltip: HTMLElement | null = null;

function dismissSuggestionTooltip() {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
  document.querySelectorAll('[data-pranan-tooltip]').forEach(el => el.remove());
}

/**
 * Create and manage an inline suggestion monitor on a compose element.
 * Returns a cleanup function.
 */
export function createSuggestionMonitor(config: SuggestionConfig): () => void {
  const {
    element,
    onCheckRequested,
    minLength = 30,
    debounceMs = 2000,
    isEnabled = passiveChecksEnabled,
  } = config;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSuggestions: InlineSuggestion[] = [];
  let dismissedIds = new Set<string>();
  let lastCheckedText = '';
  let isDestroyed = false;

  async function runCheck() {
    if (isDestroyed || !isEnabled()) return;
    const text = element.textContent?.trim() || '';
    if (text.length < minLength || text === lastCheckedText) return;

    lastCheckedText = text;

    try {
      const suggestions = await onCheckRequested(text);
      if (isDestroyed) return;

      // Filter dismissed
      activeSuggestions = suggestions.filter(s => !dismissedIds.has(s.id));
      // Send suggestions to service worker for side panel rendering
      safeSendMessage({
        type: 'GRAMMAR_SUGGESTIONS',
        payload: { suggestions: activeSuggestions, platform: 'inline' },
      }).catch(() => {});
    } catch {
      // Silently fail -- don't interrupt user's writing
    }
  }

  function onInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!isEnabled()) return;
    debounceTimer = setTimeout(runCheck, debounceMs);
  }

  element.addEventListener('input', onInput);

  // Cleanup
  return () => {
    isDestroyed = true;
    element.removeEventListener('input', onInput);
    if (debounceTimer) clearTimeout(debounceTimer);
    dismissSuggestionTooltip();
  };
}
