/**
 * Grammarly-Style Inline Suggestions
 *
 * Monitors text input in compose fields, debounces grammar/tone checks,
 * and sends suggestions to the side panel for rendering.
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
  } = config;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSuggestions: InlineSuggestion[] = [];
  let dismissedIds = new Set<string>();
  let lastCheckedText = '';
  let isDestroyed = false;

  async function runCheck() {
    if (isDestroyed) return;
    const text = element.textContent?.trim() || '';
    if (text.length < minLength || text === lastCheckedText) return;

    lastCheckedText = text;

    try {
      const suggestions = await onCheckRequested(text);
      if (isDestroyed) return;

      // Filter dismissed
      activeSuggestions = suggestions.filter(s => !dismissedIds.has(s.id));
      // Send suggestions to service worker for side panel rendering
      chrome.runtime.sendMessage({
        type: 'GRAMMAR_SUGGESTIONS',
        payload: { suggestions: activeSuggestions, platform: 'inline' },
      }).catch(() => {});
    } catch {
      // Silently fail -- don't interrupt user's writing
    }
  }

  function onInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
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
