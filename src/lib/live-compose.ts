/**
 * Re-resolve the compose an inline bar belongs to.
 *
 * The Gmail inline bar captures its compose window once, when it is injected,
 * and holds that Element in a closure for the rest of the bar's life. The
 * reference is not stable. Gmail relayouts the reply, and HubSpot Sales — which
 * this account runs — rebuilds the compose body outright. The bar itself
 * survives all of it, because the bar is injected into the THREAD container
 * (`.ip.adB`), not into the compose. So the bar stays on screen, looking
 * perfectly alive, pointed at a node that has left the document.
 *
 * Every read through that dead reference returns nothing, silently:
 *
 *   - `alignInFlow` cannot find the message body, so the bar never picks up the
 *     avatar-gutter offset and hangs 81px to the left of the compose card.
 *   - `stampEditor` marks an off-document node, so the returned draft cannot be
 *     bound back to the compose and lands in the copy-fallback instead.
 *   - `getThreadContext` / `extractRecipients` / `getSubject` return empty, so
 *     Generate asks the model to reply to a thread it never sent.
 *
 * Measured on Pratik's inbox, 29 Jul 2026, v0.8.39: bar in flow at x=324, live
 * message body at x=405 — a delta of 81px, inside the alignment window — and
 * `marginLeft` never applied, because `composeWindow.querySelector(body)` was
 * null while `document.querySelector(body)` found it. Same run: no element in
 * the document ever carried `data-pranan-editor-id`, polled at 50ms.
 *
 * Resolution is scoped to the bar's own container, and refuses when that
 * container holds more than one compose. That preserves the property the
 * editor-binding audit bought: a draft lands in the compose it was requested
 * from, or nowhere. We recover from a replaced compose; we never guess between
 * two of them.
 */

/**
 * @param bar        the injected bar, used as the search root
 * @param captured   the compose reference the bar closed over (may be stale)
 * @param bodySelector      comma-joined compose-body chain
 * @param containerSelector comma-joined compose-container chain
 * @returns the live compose, or null when there is no unambiguous answer
 */
export function resolveLiveCompose(
  bar: Element | null | undefined,
  captured: Element | null | undefined,
  bodySelector: string,
  containerSelector: string,
): Element | null {
  // Fast path: the captured reference is still attached AND still holds a
  // compose body. Both halves matter — Gmail also rebuilds the body in place,
  // which leaves a connected container that is useless to every caller.
  if (captured && captured.isConnected && captured.querySelector(bodySelector)) {
    return captured;
  }

  if (!bar || !bar.isConnected) return null;

  // Walk out from the bar to the nearest ancestor that actually contains a
  // compose. Starting at the bar keeps us inside this thread: a compose in a
  // different thread view, or a pop-out dialog elsewhere on the page, is never
  // reachable this way.
  let scope: Element | null = bar.parentElement;
  while (scope) {
    const bodies = scope.querySelectorAll(bodySelector);
    if (bodies.length === 1) {
      const body = bodies[0];
      return body.closest(containerSelector)
        // Unrecognised layout: fall back to the nearest wrapper that still
        // contains the body, so a Gmail class rename degrades the alignment
        // rather than disabling the bar.
        || body.parentElement
        || body;
    }
    // More than one open compose under this ancestor — ambiguous. Stop rather
    // than widen further, because widening can only make it more ambiguous.
    if (bodies.length > 1) return null;
    scope = scope.parentElement;
  }

  return null;
}
