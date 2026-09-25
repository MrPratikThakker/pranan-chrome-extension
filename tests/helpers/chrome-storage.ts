import { vi } from 'vitest';

type Store = Record<string, unknown>;

/**
 * An in-memory chrome.storage area that understands the key shapes the real
 * API accepts (string, string[], or undefined for everything).
 */
export function memoryArea(initial: Store = {}) {
  const data: Store = { ...initial };
  const pick = (keys?: string | string[] | null) => {
    if (keys === undefined || keys === null) return { ...data };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Store = {};
    for (const key of list) if (data[key] !== undefined) out[key] = data[key];
    return out;
  };
  return {
    data,
    get: vi.fn(async (keys?: string | string[] | null) => pick(keys)),
    set: vi.fn(async (values: Store) => { Object.assign(data, values); }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  };
}

/**
 * chrome.storage with local and session areas. Tokens belong in session
 * (audit EXT-10); local keeps preferences and any legacy copy.
 */
export function installChromeStorage(options: { local?: Store; session?: Store } = {}) {
  const local = memoryArea(options.local);
  const session = memoryArea(options.session);
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const storage = {
    local,
    session,
    onChanged: {
      addListener: vi.fn((fn: (typeof listeners)[number]) => { listeners.push(fn); }),
      removeListener: vi.fn(),
    },
  };
  return { storage, local, session, listeners };
}
