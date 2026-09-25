/**
 * Where the extension keeps its Pranan session tokens.
 *
 * Audit EXT-10: the access and refresh tokens used to live in
 * chrome.storage.local. Chrome cannot restrict that area, so every content
 * script (Gmail, Slack, LinkedIn) could read the long-lived refresh token, and
 * a compromised renderer on any of those sites could take it.
 *
 * Tokens now live in two places that content scripts cannot reach:
 *
 *  - chrome.storage.session, which Chrome limits to trusted extension contexts
 *    (service worker, popup, side panel) by default. The service worker also
 *    sets that access level explicitly at startup.
 *  - IndexedDB on the extension's own origin, so a browser restart does not
 *    sign the user out. Content scripts run in the page's origin and cannot
 *    open the extension origin's database.
 *
 * Content scripts must never import this module. They reach the API only by
 * messaging the service worker.
 *
 * Existing installs kept their tokens in chrome.storage.local. The first
 * trusted read moves them here and deletes the old copy.
 */

export interface AuthTokens {
  authToken: string | null;
  refreshToken: string | null;
}

const TOKEN_KEYS: Array<keyof AuthTokens> = ['authToken', 'refreshToken'];
const TOKEN_KEY_NAMES: string[] = TOKEN_KEYS;
const DB_NAME = 'pranan-auth';
const DB_STORE = 'tokens';
const DB_RECORD = 'current';

function normalize(raw: Record<string, unknown> | null | undefined): AuthTokens {
  return {
    authToken: typeof raw?.authToken === 'string' && raw.authToken ? raw.authToken : null,
    refreshToken: typeof raw?.refreshToken === 'string' && raw.refreshToken ? raw.refreshToken : null,
  };
}

function hasAny(tokens: AuthTokens): boolean {
  return !!(tokens.authToken || tokens.refreshToken);
}

function sessionArea(): chrome.storage.StorageArea | null {
  try {
    return chrome?.storage?.session ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// IndexedDB persistence (extension origin only)
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) {
          request.result.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistedRead(): Promise<AuthTokens | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_RECORD);
      request.onsuccess = () => { db.close(); resolve(normalize(request.result as Record<string, unknown> | undefined)); };
      request.onerror = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function persistedWrite(tokens: AuthTokens | null): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      if (tokens && hasAny(tokens)) store.put(tokens, DB_RECORD);
      else store.delete(DB_RECORD);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace both stored tokens. A null refresh token removes any stale one, so a
 * re-auth can never leave a refresh token from a previous session behind.
 * Returns true when the tokens landed in at least one trusted store.
 */
export async function writeAuthTokens(tokens: AuthTokens): Promise<boolean> {
  const clean = normalize(tokens as unknown as Record<string, unknown>);
  let stored = false;
  const area = sessionArea();
  if (area) {
    try {
      const present: Record<string, string> = {};
      const absent: string[] = [];
      for (const key of TOKEN_KEYS) {
        const value = clean[key];
        if (value) present[key] = value;
        else absent.push(key);
      }
      if (Object.keys(present).length) await area.set(present);
      if (absent.length) await area.remove(absent);
      stored = true;
    } catch { /* fall through to the persisted copy */ }
  }
  const persisted = await persistedWrite(clean);
  return stored || persisted;
}

/** Remove the tokens everywhere, including the legacy chrome.storage.local copy. */
export async function clearAuthTokens(): Promise<void> {
  const area = sessionArea();
  if (area) {
    try { await area.remove(TOKEN_KEY_NAMES); } catch { /* pass */ }
  }
  await persistedWrite(null);
  try { await chrome.storage.local.remove(TOKEN_KEY_NAMES); } catch { /* pass */ }
}

/**
 * Read the current tokens from a trusted context. Falls back to the persisted
 * copy after a browser restart, then to the legacy chrome.storage.local copy,
 * which is migrated and deleted.
 */
export async function readAuthTokens(): Promise<AuthTokens> {
  const area = sessionArea();
  if (area) {
    try {
      const fromSession = normalize((await area.get(TOKEN_KEY_NAMES)) as Record<string, unknown>);
      if (hasAny(fromSession)) return fromSession;
    } catch { /* not a trusted context, or storage unavailable */ }
  }

  const persisted = await persistedRead();
  if (persisted && hasAny(persisted)) {
    if (area) {
      const present: Record<string, string> = {};
      if (persisted.authToken) present.authToken = persisted.authToken;
      if (persisted.refreshToken) present.refreshToken = persisted.refreshToken;
      try { await area.set(present); } catch { /* pass */ }
    }
    return persisted;
  }

  let legacy: AuthTokens = { authToken: null, refreshToken: null };
  try {
    legacy = normalize((await chrome.storage.local.get(TOKEN_KEY_NAMES)) as Record<string, unknown>);
  } catch { /* pass */ }
  if (hasAny(legacy)) {
    // Only delete the old copy once the tokens are safely stored elsewhere,
    // so a context without trusted storage never loses the session.
    if (await writeAuthTokens(legacy)) {
      try { await chrome.storage.local.remove(TOKEN_KEY_NAMES); } catch { /* pass */ }
    }
  }
  return legacy;
}

/**
 * Keep chrome.storage.session limited to trusted contexts. This is Chrome's
 * default, but setting it explicitly means a future change elsewhere cannot
 * quietly open the tokens to content scripts. Service worker only.
 */
export async function restrictTokenStorageToTrustedContexts(): Promise<void> {
  const area = sessionArea() as (chrome.storage.StorageArea & {
    setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
  }) | null;
  if (!area?.setAccessLevel) return;
  try {
    await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch { /* older Chrome: the default is already trusted-only */ }
}
