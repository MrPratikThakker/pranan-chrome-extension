/**
 * Editor binding (correlation token)
 *
 * Audit (HIGH): the generate -> insert path historically carried only
 * { text }. Insertion targeted whatever editor was current at insertion
 * time (Gmail composeWindows[0], Slack's active input, LinkedIn's last
 * comment box). If the user switched tab/compose/post between pressing
 * Generate and the draft returning, the draft was injected into the WRONG
 * place.
 *
 * Fix: when a generation is initiated from a specific editor element we
 * stamp it with a stable id (data-pranan-editor-id) and thread that id
 * through the request payload and the INSERT_DRAFT / INSERT_COMMENT_DRAFT
 * message. At insertion time the content script resolves the element with
 * that EXACT id; if it is gone we DO NOT fall back to "current" -- we
 * return a structured non-insert result so the UI can offer copy.
 *
 * Backward compatible: if a message has no editorId (older callers, or
 * non-inline surfaces that never stamped one), callers keep their existing
 * behavior.
 */

export const EDITOR_ID_ATTR = 'data-pranan-editor-id';
export const EDITOR_ID_DATASET = 'prananEditorId';

export const EDITOR_HOST_ATTR = 'data-pranan-editor-host-id';

// Compose-container ancestors that survive an editor re-render. HubSpot Sales
// rebuilds the contenteditable, and Gmail sometimes relayouts it, but these
// outer boundaries (the compose dialog, the compose <form>, the inline-reply
// containers) persist. Binding the host lets resolveEditor re-find the SAME
// compose's current editor instead of falsely reporting a moved compose.
// Deliberately compose-scoped (never a thread-level container) so the host
// always holds exactly one editor -> no wrong-place risk.
const HOST_SELECTOR = '[role="dialog"], form, .iN, .aoI, .aO7, .M9';

function currentEditableIn(host: Element): HTMLElement | null {
  const el = host.querySelector(
    '[contenteditable="true"][role="textbox"], [g_editable="true"], [contenteditable="true"]',
  );
  return el instanceof HTMLElement ? el : null;
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `pe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stamp an editor element with a stable correlation id and return it.
 * Re-uses an existing id if the element already carries one, so repeated
 * Generate clicks on the same compose keep the same binding.
 */
export function stampEditor(el: Element | null | undefined): string | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  const existing = el.getAttribute(EDITOR_ID_ATTR);
  const id = existing || makeId();
  if (!existing) el.setAttribute(EDITOR_ID_ATTR, id);
  // Also bind a stable compose-container ancestor so the binding survives the
  // editor element being re-rendered/replaced (HubSpot Sales, Gmail relayout).
  // Best-effort: if no host matches, behavior is unchanged.
  try {
    const host = el.closest(HOST_SELECTOR);
    if (host instanceof HTMLElement && host !== el && !host.getAttribute(EDITOR_HOST_ATTR)) {
      host.setAttribute(EDITOR_HOST_ATTR, id);
    }
  } catch {
    /* ignore */
  }
  return id;
}

/**
 * Resolve a previously-stamped editor element by its correlation id.
 * Returns null if no element with that exact id is present in the DOM.
 */
export function resolveEditor(editorId: string | null | undefined): HTMLElement | null {
  if (!editorId) return null;
  const esc = (window as unknown as { CSS?: { escape?(s: string): string } }).CSS?.escape
    ? CSS.escape(editorId)
    : editorId;
  try {
    const exact = document.querySelector(`[${EDITOR_ID_ATTR}="${esc}"]`);
    if (exact instanceof HTMLElement) return exact;
    // The editor element was re-rendered away (e.g. HubSpot Sales rebuilt the
    // compose body). Recover via the stable host container: return its CURRENT
    // editable, still the SAME compose the draft was requested from, so there is
    // no wrong-place risk. If the host is also gone, the user truly switched
    // compose -> null -> the UI offers copy.
    const host = document.querySelector(`[${EDITOR_HOST_ATTR}="${esc}"]`);
    if (host instanceof HTMLElement) {
      const cur = currentEditableIn(host);
      if (cur) {
        cur.setAttribute(EDITOR_ID_ATTR, editorId); // re-stamp so future resolves are O(1)
        return cur;
      }
    }
    return null;
  } catch {
    return null;
  }
}
