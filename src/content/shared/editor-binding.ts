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
  if (existing) return existing;
  const id = makeId();
  el.setAttribute(EDITOR_ID_ATTR, id);
  return id;
}

/**
 * Resolve a previously-stamped editor element by its correlation id.
 * Returns null if no element with that exact id is present in the DOM.
 */
export function resolveEditor(editorId: string | null | undefined): HTMLElement | null {
  if (!editorId) return null;
  const sel = `[${EDITOR_ID_ATTR}="${(window as unknown as { CSS?: { escape?(s: string): string } }).CSS?.escape ? CSS.escape(editorId) : editorId}"]`;
  try {
    return document.querySelector(sel) as HTMLElement | null;
  } catch {
    return null;
  }
}
