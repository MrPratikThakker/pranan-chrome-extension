/**
 * One live copy of a content script per page.
 *
 * Audit EXT-21: the worker re-injects content/gmail.js whenever a PING goes
 * unanswered, and that can race the manifest's own document_idle injection,
 * or run beside a copy left over from before an extension update. Two copies
 * mean two observers, two grammar monitors and two TEXT_SELECTED messages.
 *
 * The first copy registers a liveness probe on the page's isolated-world
 * window. A later copy stands down while that probe says the first copy can
 * still reach the extension. A copy orphaned by an update cannot, so the new
 * copy takes over instead of leaving the page with a dead one.
 */

interface InstanceProbe {
  alive(): boolean;
}

type GuardedWindow = Window & { __prananContentInstances?: Record<string, InstanceProbe> };

function extensionReachable(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Returns true when this copy should run, false when another live copy of the
 * same script already owns the page.
 */
export function claimContentScriptInstance(
  key: string,
  probe: InstanceProbe = { alive: extensionReachable },
  win: Window = window,
): boolean {
  const guarded = win as GuardedWindow;
  const registry = (guarded.__prananContentInstances ??= {});
  const existing = registry[key];
  if (existing) {
    let stillAlive = false;
    try { stillAlive = existing.alive(); } catch { stillAlive = false; }
    if (stillAlive) return false;
  }
  registry[key] = probe;
  return true;
}
