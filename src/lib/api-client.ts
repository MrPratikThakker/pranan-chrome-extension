/**
 * Pranan Companion API Client
 *
 * Typed client for all /api/companion/* endpoints.
 * Runs in trusted extension contexts only: the service worker, the popup and
 * the side panel. Content scripts never call it directly; they message the
 * service worker (audit EXT-07, EXT-10), because a content-script fetch runs
 * with the page's origin and the tokens are not readable there.
 */

import type {
  ContactContext,
  DraftResponse,
  RewriteResponse,
  GrammarResponse,
  AuthResponse,
  MeetingBriefing,
  FollowUpNudge,
  DecayAlert,
  ActiveSession,
} from '@/types';

import { captureError } from '@/lib/observability';
import { readAuthTokens, writeAuthTokens, clearAuthTokens } from '@/lib/token-store';

// Module-level flag to dedup parallel 401 cleanup. See handleResponse 401 branch.
let authExpiryInFlight = false;

/**
 * In the service worker, chrome.runtime.sendMessage never reaches the worker's
 * own onMessage listener, so a 401 seen there used to leave the worker's
 * cached auth stale and never told the side panel (audit EXT-24). The worker
 * registers a handler here instead.
 */
let authExpiredHandler: (() => void) | null = null;
export function setAuthExpiredHandler(handler: (() => void) | null): void {
  authExpiredHandler = handler;
}

/**
 * Broadcast that auth has expired so the popup + side panel flip to the
 * reconnect CTA. Deduped via authExpiryInFlight so concurrent 401s only fire
 * one cleanup + broadcast. Shared by handleResponse and the snapshot path so
 * a 401 can never be silently swallowed into a dead, dashed-out UI
 * (Pranan live-debug 2026-06-09: popup showed "connected" + all "\u2014" because
 * getTodaySnapshot ate the 401 instead of prompting reconnect).
 *
 * Only reached once the session is really over: authedFetch has already tried
 * one refresh (EXT-08), and a refresh that failed for a transient reason
 * (429, 5xx, timeout) throws before this point instead of logging out.
 */
async function notifyAuthExpired(): Promise<void> {
  if (authExpiryInFlight) return;
  authExpiryInFlight = true;
  // Audit (LOW): clear BOTH tokens on auth-expiry. Clearing only authToken left
  // a stale refreshToken behind, which the refresh path would keep trying.
  try { await clearAuthTokens(); } catch { /* pass */ }
  if (IS_SERVICE_WORKER && authExpiredHandler) {
    try { authExpiredHandler(); } catch { /* pass */ }
  } else {
    // The try/catch below only covers a SYNCHRONOUS throw (dead extension
    // context). It does not cover the promise, and this broadcast rejects
    // whenever nothing is listening -- which is the normal case, because the
    // popup and side panel are closed almost all the time. Nothing is broken
    // when it fires; the broadcast simply has no audience.
    try {
      chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' })
        .catch(() => { /* no popup or side panel open to hear it */ });
    } catch { /* extension context gone */ }
  }
  setTimeout(() => { authExpiryInFlight = false; }, 5000);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

import { API_BASE, APP_ORIGIN, appUrl } from './config';

// ---------------------------------------------------------------------------
// Auth
//
// Companion requests are cross-site (extension -> app.pranan.ai), so the
// SameSite=Lax session cookie is not the path the extension relies on. Every
// request carries `Authorization: Bearer <access token>` from the trusted
// token store (token-store.ts). `credentials: 'include'` is kept so the
// server's cookie fallback still works where the browser sends the cookie.
// ---------------------------------------------------------------------------

async function getLegacyAuthToken(): Promise<string | null> {
  try {
    return (await readAuthTokens()).authToken;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bearer refresh (Option A) — keep the access token fresh without cookies.
//
// The access token expires (~1h). When it nears expiry we mint a fresh one
// server-side via POST /api/companion/refresh using the stored refresh token.
// Supabase credentials stay on the server.
// ---------------------------------------------------------------------------

async function getRefreshToken(): Promise<string | null> {
  try {
    return (await readAuthTokens()).refreshToken;
  } catch {
    return null;
  }
}

function jwtExpMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * What happened on the last refresh attempt.
 *
 *  refreshed         a new access token is stored
 *  rejected          /refresh answered 401: the refresh token is dead, both
 *                    tokens were cleared and the user must reconnect
 *  unavailable       429, 5xx, timeout or network failure: the refresh token
 *                    may be perfectly valid, so it is KEPT (audit EXT-08)
 *  no_refresh_token  nothing to refresh with
 */
export type RefreshOutcome = 'refreshed' | 'rejected' | 'unavailable' | 'no_refresh_token';

export interface RefreshResult {
  token: string | null;
  outcome: RefreshOutcome;
}

// Dedup concurrent refreshes so a burst of requests triggers exactly one.
let refreshInFlight: Promise<RefreshResult> | null = null;

export async function refreshAccessTokenWithOutcome(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async (): Promise<RefreshResult> => {
    const { refreshToken } = await readAuthTokens().catch(() => ({ authToken: null, refreshToken: null }));
    if (!refreshToken) return { token: null, outcome: 'no_refresh_token' };
    try {
      const res = await fetch(`${APP_ORIGIN}/api/companion/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        // Only a 401 from /refresh itself means the refresh token is dead.
        // A rate limit or server error must not delete a token that still
        // works (audit EXT-08 / XP-13).
        if (res.status === 401) {
          try { await clearAuthTokens(); } catch { /* pass */ }
          return { token: null, outcome: 'rejected' };
        }
        return { token: null, outcome: 'unavailable' };
      }
      const data = await res.json();
      if (data?.token) {
        await writeAuthTokens({
          authToken: data.token,
          refreshToken: data.refreshToken || refreshToken,
        });
        return { token: data.token as string, outcome: 'refreshed' };
      }
      return { token: null, outcome: 'unavailable' };
    } catch {
      return { token: null, outcome: 'unavailable' };
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function refreshAccessToken(): Promise<string | null> {
  return (await refreshAccessTokenWithOutcome()).token;
}

// Refresh tokens are single-use and rotate server-side, so only ONE context may
// ever call POST /api/companion/refresh at a time. The popup and side panel
// each bundle their own copy of this module with their own refreshInFlight, so
// without coordination two contexts could refresh in parallel, consume the
// same rotating token, and force a logout. We therefore make the service
// worker the single owner of refresh: every non-SW context asks the SW to
// refresh (which persists the new token) and then re-reads the fresh token.
// (token-refresh centralization 2026-06-09)
const IS_SERVICE_WORKER = typeof window === 'undefined';

async function refreshViaServiceWorker(): Promise<RefreshResult> {
  let reply: { outcome?: RefreshOutcome } | null | undefined;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'REFRESH_TOKEN' });
  } catch {
    // SW unreachable (rare) -> fall back to a local refresh so auth still works.
    return refreshAccessTokenWithOutcome();
  }
  const token = await getLegacyAuthToken();
  const outcome = reply?.outcome ?? (token ? 'refreshed' : 'unavailable');
  return { token: outcome === 'refreshed' ? token : null, outcome };
}

function refreshNow(): Promise<RefreshResult> {
  return IS_SERVICE_WORKER ? refreshAccessTokenWithOutcome() : refreshViaServiceWorker();
}

function refreshUnavailableError(): ApiError {
  return new ApiError(
    'Pranan could not refresh your session right now. Try again in a moment.',
    503,
    'AUTH_REFRESH_UNAVAILABLE',
  );
}

/**
 * Return a valid access token, refreshing first if the stored one is missing
 * an exp, expired, or within 2 minutes of expiry.
 *
 * If the refresh fails for a transient reason and the stored token has
 * already expired, this throws a 503 instead of returning the expired token.
 * Sending it would only earn a 401, and the 401 path used to delete a refresh
 * token that was still valid (audit EXT-08 / XP-13).
 */
async function ensureValidToken(): Promise<string | null> {
  const token = await getLegacyAuthToken();
  if (!token) return null;
  const expMs = jwtExpMs(token);
  if (expMs && expMs - Date.now() > 120_000) return token;
  // Needs refresh. The SW owns refresh; everyone else delegates to it so the
  // single-use rotating refresh token is never consumed by two racers.
  const { token: refreshed, outcome } = await refreshNow();
  if (refreshed) return refreshed;
  if (outcome === 'rejected') return null;
  if (outcome === 'unavailable' && expMs && expMs <= Date.now()) throw refreshUnavailableError();
  return token;
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers, credentials: 'include' };
}

/**
 * A 401 with a token in hand may only mean the access token was revoked or
 * rotated a moment ago. Try one refresh and one retry before treating the
 * session as over (audit EXT-08). Returns null when there is nothing better
 * to retry with, and throws when the refresh failed for a transient reason so
 * the caller never logs the user out over a rate limit or a server blip.
 */
async function retryAfter401(token: string | null): Promise<string | null> {
  if (!token) return null;
  const { token: fresh, outcome } = await refreshNow();
  if (fresh && fresh !== token) return fresh;
  if (outcome === 'unavailable') throw refreshUnavailableError();
  return null;
}

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureValidToken();
  init.signal?.throwIfAborted();
  const response = await fetch(url, withAuth(init, token));
  if (response.status !== 401) return response;
  const fresh = await retryAfter401(token);
  if (!fresh) return response;
  init.signal?.throwIfAborted();
  return fetch(url, withAuth(init, fresh));
}

/**
 * Variant of authedFetch that auto-retries on transient failures (5xx,
 * network drop). Backoff lives inside fetchWithRetry; this wrapper threads
 * the Bearer token through every retry.
 */
async function authedFetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number } = {}
): Promise<Response> {
  const token = await ensureValidToken();
  init.signal?.throwIfAborted();
  const response = await fetchWithRetry(url, withAuth(init, token), opts);
  if (response.status !== 401) return response;
  const fresh = await retryAfter401(token);
  if (!fresh) return response;
  init.signal?.throwIfAborted();
  return fetchWithRetry(url, withAuth(init, fresh), opts);
}

// ---------------------------------------------------------------------------
// fetchWithRetry — capped exponential backoff for transient failures
// ---------------------------------------------------------------------------

/**
 * Wrapper around fetch that retries on network error or 5xx responses.
 * Backoff is 250ms / 500ms / 1000ms (capped at 3 retries).
 *
 * Does NOT retry on:
 *   - 4xx responses (auth errors, bad requests, rate limits — those are
 *     deterministic and retrying just makes things worse)
 *   - AbortError (the caller cancelled — never retry a cancellation)
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Retry on 5xx but not 4xx. 4xx is the caller's problem.
      if (response.status >= 500 && response.status < 600 && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return response;
    } catch (err) {
      // Don't retry user cancellation.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }
  // Unreachable but keeps TS happy.
  throw lastErr ?? new Error('fetchWithRetry: unknown failure');
}

function backoffMs(attempt: number): number {
  // 0 -> 250, 1 -> 500, 2 -> 1000, capped.
  return Math.min(250 * Math.pow(2, attempt), 1500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  /** For a 402: where the user can upgrade (absolute app URL). */
  upgradeUrl?: string;

  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Error reports never carry query strings (the /context lookup puts email
 * addresses and names there) or response bodies (audit EXT-20).
 */
function reportableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/** Only same-app relative paths are accepted as an upgrade link. */
function upgradeLink(path: unknown): string {
  const safe = typeof path === 'string' && /^\/(?!\/)[\w\-/?=&.]*$/.test(path) ? path : '/settings/billing';
  return appUrl(safe);
}

async function handleResponse<T>(response: Response): Promise<T> {
  // Auto-recovery: if a successful response arrives while we recently
  // broadcast AUTH_EXPIRED, the underlying auth has self-healed (cookie
  // refreshed, transient blip recovered, etc). Tell the side panel +
  // popup so the 'Not authenticated' banner clears automatically.
  // Without this, a single transient 401 leaves the banner showing
  // until the user manually clicks Reconnect — even though every
  // subsequent API call works. Real bug observed by Pratik 2026-05-08.
  if (response.ok && authExpiryInFlight) {
    authExpiryInFlight = false;
    try {
      // Same as AUTH_EXPIRED above: the catch here is for a dead context, not
      // for the promise. Without .catch() this rejects into the console every
      // time auth recovers with no popup or side panel open.
      chrome.runtime.sendMessage({ type: 'AUTH_RECOVERED' })
        .catch(() => { /* no popup or side panel open to hear it */ });
    } catch { /* sender may not be a content script */ }
  }

  if (!response.ok) {
    const body = await response.text();
    let serverMessage: string | undefined;
    let code: string | undefined;
    let parsed: Record<string, unknown> | null = null;

    try {
      parsed = JSON.parse(body);
      const candidate = parsed?.error || parsed?.message;
      serverMessage = typeof candidate === 'string' && candidate ? candidate : undefined;
      code = typeof parsed?.code === 'string' ? parsed.code : undefined;
    } catch {
      // Use default message
    }
    const message = serverMessage || `API error: ${response.status}`;
    const url = reportableUrl(response.url);

    if (response.status === 429) {
      // Keep the server's reason. A daily budget that resets at midnight UTC
      // and a two-minute burst limit need different advice (XP-09, XP-31).
      const limitCode = code
        || (serverMessage && /daily budget/i.test(serverMessage) ? 'DAILY_BUDGET' : 'RATE_LIMITED');
      const err = new ApiError(serverMessage || 'Rate limit exceeded. Please wait a moment.', 429, limitCode);
      captureError(err, { component: 'api-client', metadata: { status: 429, url, code: limitCode } });
      throw err;
    }
    if (response.status === 402) {
      // Plan quota used up. Previously unhandled, so the user saw "try again"
      // and never an upgrade path (XP-09).
      const err = new ApiError(serverMessage || 'Monthly draft limit reached.', 402, code || 'QUOTA_EXCEEDED');
      err.upgradeUrl = upgradeLink(parsed?.upgrade_url);
      throw err;
    }
    if (response.status === 401) {
      // Auth expired -> broadcast so the UI prompts reconnect (deduped).
      await notifyAuthExpired();
      const err = new ApiError('Session expired. Please reconnect.', 401, 'UNAUTHORIZED');
      captureError(err, { component: 'api-client', metadata: { url } });
      throw err;
    }
    if (response.status >= 500) {
      const err = new ApiError(message, response.status, code);
      captureError(err, { component: 'api-client', metadata: { status: response.status, url } });
      throw err;
    }

    throw new ApiError(message, response.status, code);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// GET /api/companion/auth -- validate session
// ---------------------------------------------------------------------------

export async function validateAuth(): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await authedFetch(`${API_BASE}/auth`);
  } catch (e) {
    // Network error or a refresh that could not complete. Don't sign the user
    // out, but only report a signed-in session when there is one to keep
    // (audit EXT-22: offline users who never signed in saw the signed-in UI).
    console.warn('[API] validateAuth: network error, treating as transient', e);
    return transientAuth();
  }
  // Server signaling transient failure (503 with transient flag, e.g. Supabase
  // blip). Don't clear the token; let the next call retry.
  if (response.status === 503) {
    console.warn('[API] validateAuth: 503 from server, treating as transient');
    return transientAuth();
  }
  return handleResponse<AuthResponse>(response);
}

async function transientAuth(): Promise<AuthResponse> {
  const tokens = await readAuthTokens().catch(() => ({ authToken: null, refreshToken: null }));
  const hadSession = !!(tokens.authToken || tokens.refreshToken);
  return { valid: hadSession, transient: true } as unknown as AuthResponse;
}

// ---------------------------------------------------------------------------
// POST /api/companion/exchange -- one-time sign-in nonce -> tokens
// ---------------------------------------------------------------------------

/**
 * Service worker only. Lets the app hand the extension its one-time sign-in
 * nonce instead of the tokens, so the tokens never pass through page script
 * on app.pranan.ai (audit EXT-09). The nonce is single-use server-side.
 */
export async function exchangeLoginNonce(nonce: string): Promise<{ token: string; refreshToken: string | null } | null> {
  try {
    const response = await fetch(`${API_BASE}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { token?: unknown; refreshToken?: unknown };
    if (typeof data?.token !== 'string' || !data.token) return null;
    return { token: data.token, refreshToken: typeof data.refreshToken === 'string' && data.refreshToken ? data.refreshToken : null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/companion/context -- relationship context for a contact
// ---------------------------------------------------------------------------

export async function getContactContext(
  params: { email?: string; name?: string; linkedinUrl?: string; mailboxEmail?: string }
): Promise<ContactContext> {
  const query = new URLSearchParams();
  if (params.mailboxEmail) query.set('mailboxEmail', params.mailboxEmail);
  if (params.email) query.set('email', params.email);
  if (params.name) query.set('name', params.name);
  if (params.linkedinUrl) query.set('linkedinUrl', params.linkedinUrl);

  const response = await authedFetchWithRetry(`${API_BASE}/context?${query}`);
  return handleResponse<ContactContext>(response);
}

// ---------------------------------------------------------------------------
// POST /api/companion/draft -- generate a draft (JSON; the server does not stream)
// ---------------------------------------------------------------------------

export interface DraftRequest {
  mailboxEmail?: string;
  currentDraft?: string;
  recipientEmail?: string;
  recipientName?: string;
  threadId?: string;
  messageToReplyTo?: string;
  platform?: string;
  channelName?: string;
  prompt?: string;
  tone?: string;
  /**
   * LinkedIn compose variant. 'comment' triggers a different prompt shape on
   * the backend (short, post-context-aware, less email-formal).
   */
  composeType?: 'message' | 'post' | 'comment';
  /** LinkedIn post permalink, used for relationship lookup + telemetry. */
  postUrl?: string;
  /**
   * LinkedIn post author's profile URL. The server resolves the author's
   * relationship from it; the worker used to drop it (XP-25).
   */
  postAuthorUrl?: string;
}

/**
 * The server returns an intentional skip as { skipped, reason, message }, but
 * the worker and the content scripts read skipReason/skipMessage. Map here so
 * the specific reason ("This email is addressed to Jigar, you are only
 * copied") reaches the user instead of a generic "Draft skipped."
 */
function normalizeDraftResponse(data: DraftResponse & { reason?: string; message?: string }): DraftResponse {
  if (data?.skipped) {
    return {
      ...data,
      skipReason: data.skipReason ?? data.reason,
      skipMessage: data.skipMessage ?? data.message,
    };
  }
  return data;
}

export async function generateDraft(request: DraftRequest, signal?: AbortSignal): Promise<DraftResponse> {
  const response = await authedFetchWithRetry(`${API_BASE}/draft`, { method: 'POST', body: JSON.stringify(request), signal }, { retries: 0 });
  const data = await handleResponse<DraftResponse & { reason?: string; message?: string }>(response);
  return normalizeDraftResponse(data);
}

// ---------------------------------------------------------------------------
// POST /api/companion/intents -- one-tap reply intents for a thread
// ---------------------------------------------------------------------------

export interface IntentsRequest {
  mailboxEmail?: string;
  platform?: string;
  recipientEmail?: string | null;
  recipientName?: string | null;
  subject?: string | null;
  messageToReplyTo?: string | null;
}

/**
 * POST /api/companion/transcribe. Called from the side panel and from the
 * service worker (TRANSCRIBE_AUDIO) on behalf of content scripts, never from a
 * content script directly: there the fetch runs with the page's origin and the
 * server's CORS policy rejects it (audit EXT-07).
 */
export async function transcribeAudio(audio: Blob): Promise<string> {
  const form = new FormData();
  const extension = audio.type.includes('ogg') ? 'ogg'
    : audio.type.includes('mp4') ? 'mp4'
      : audio.type.includes('wav') ? 'wav'
        : 'webm';
  form.set('audio', audio, `voice.${extension}`);
  const response = await authedFetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await handleResponse<{ text?: string }>(response);
  const text = data.text?.trim() || '';
  if (!text) throw new ApiError('No speech was detected.', 422, 'NO_SPEECH');
  return text;
}

/**
 * R2: one-click tier correction from the side panel / inline pill. Sets a
 * manual tier override server-side; the classifier never overwrites manual
 * rows, so the correction sticks and becomes training signal.
 */
export async function setTierOverride(contactEmail: string, tier: string): Promise<{ ok: boolean; tier?: string }> {
  try {
    const response = await authedFetch(`${API_BASE}/tier-override`, {
      method: 'POST',
      body: JSON.stringify({ contactEmail, tier }),
    });
    if (!response.ok) return { ok: false };
    const data = (await response.json()) as { ok?: boolean; tier?: string };
    return { ok: !!data.ok, tier: data.tier };
  } catch {
    return { ok: false };
  }
}

/**
 * POST /api/companion/voice-exemplar -- save a LinkedIn comment the user has
 * posted as a voice sample. Only called when the user has turned on "Learn my
 * voice from LinkedIn comments" (off by default, audit EXT-03). Fire-and-
 * forget; failures are swallowed so capture never interferes with posting.
 */
export async function postVoiceExemplar(comment: string): Promise<{ added: boolean }> {
  try {
    const response = await authedFetch(`${API_BASE}/voice-exemplar`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) return { added: false };
    const data = (await response.json()) as { added?: boolean };
    return { added: !!data.added };
  } catch {
    return { added: false };
  }
}

export async function getReplyIntents(request: IntentsRequest): Promise<string[]> {
  try {
    const response = await authedFetch(`${API_BASE}/intents`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { intents?: string[] };
    return Array.isArray(data.intents) ? data.intents.slice(0, 3) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// POST /api/companion/rewrite -- rewrite text in user's voice
// ---------------------------------------------------------------------------

export interface RewriteRequest {
  text: string;
  recipientEmail?: string;
  platform?: string;
  targetTone?: string;
  preserveIntent?: boolean;
}

export async function rewriteText(request: RewriteRequest, signal?: AbortSignal): Promise<RewriteResponse> {
  const response = await authedFetchWithRetry(`${API_BASE}/rewrite`, { method: 'POST', body: JSON.stringify(request), signal });
  return handleResponse<RewriteResponse>(response);
}

// ---------------------------------------------------------------------------
// POST /api/companion/grammar -- grammar + tone check
// ---------------------------------------------------------------------------

export interface GrammarRequest {
  text: string;
  recipientEmail?: string;
  platform?: string;
  context?: string;
}

export async function checkGrammar(request: GrammarRequest, signal?: AbortSignal): Promise<GrammarResponse> {
  const response = await authedFetchWithRetry(`${API_BASE}/grammar`, { method: 'POST', body: JSON.stringify(request), signal });
  return handleResponse<GrammarResponse>(response);
}

// ---------------------------------------------------------------------------
// Phase 5: Intelligence Layer
// Read-only panels. Each function returns an empty array on any failure so a
// briefing or nudge outage never breaks the side panel.
// ---------------------------------------------------------------------------

async function safeJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  if (response.status === 404) return fallback;
  if (!response.ok) return fallback;
  try {
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

// GET /api/companion/briefings -- pre-meeting briefings
export async function getBriefings(): Promise<MeetingBriefing[]> {
  try {
      const response = await authedFetchWithRetry(`${API_BASE}/briefings`);
    return safeJsonResponse<MeetingBriefing[]>(response, []);
  } catch {
    return [];
  }
}

// GET /api/companion/nudges -- follow-up nudges
export async function getNudges(): Promise<FollowUpNudge[]> {
  try {
      const response = await authedFetchWithRetry(`${API_BASE}/nudges`);
    return safeJsonResponse<FollowUpNudge[]>(response, []);
  } catch {
    return [];
  }
}

// GET /api/companion/decay-alerts -- relationship decay alerts
export async function getDecayAlerts(): Promise<DecayAlert[]> {
  try {
      const response = await authedFetchWithRetry(`${API_BASE}/decay-alerts`);
    return safeJsonResponse<DecayAlert[]>(response, []);
  } catch {
    return [];
  }
}

// POST /api/companion/nudges/:id/dismiss -- dismiss a nudge
export async function dismissNudge(nudgeId: string): Promise<void> {
  const response = await authedFetch(`${API_BASE}/nudges/${encodeURIComponent(nudgeId)}/dismiss`, { method: 'POST' });
  await handleResponse<{ dismissed?: boolean }>(response);
}

// POST /api/companion/nudges/:id/draft -- generate draft from nudge
export async function draftFromNudge(nudgeId: string, signal?: AbortSignal): Promise<DraftResponse> {
  const response = await authedFetch(`${API_BASE}/nudges/${encodeURIComponent(nudgeId)}/draft`, { method: 'POST', signal });
  const data = await handleResponse<DraftResponse & { reason?: string; message?: string }>(response);
  return normalizeDraftResponse(data);
}

// GET /api/companion/today -- one-shot snapshot for popup today-at-a-glance.
// Returns: { draftsReady, threadsAwaiting, voiceScore, voiceDirection,
//           topNudge, lastSyncAgo }. Cached 60s server-side so multiple
// popup opens stay fast.
export interface TodaySnapshot {
  draftsReady: number;
  threadsAwaiting: number;
  voiceScore: number | null;
  voiceDirection: 'up' | 'down' | 'flat';
  voiceDelta: number;
  topNudge: { id: string; subject: string; recipient: string } | null;
  lastSyncAgo: string | null;
  pipelineHealthy: boolean;
}

export async function getTodaySnapshot(): Promise<TodaySnapshot | null> {
  try {
    const response = await authedFetch(`${API_BASE}/today`);
    // A 401 here used to be swallowed into null -> the popup rendered four
    // dashes while still showing "connected", which looks broken. Surface it
    // so the popup flips to the reconnect CTA (2026-06-09).
    if (response.status === 401) {
      await notifyAuthExpired();
      return null;
    }
    return safeJsonResponse<TodaySnapshot>(response, null as any);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/companion/snippets — personal + org snippets for the side panel
// ---------------------------------------------------------------------------

export interface Snippet {
  id: string;
  owner_user_id: string;
  org_id: string | null;
  scope: 'personal' | 'org';
  name: string;
  title: string | null;
  body: string;
  tags: string[];
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSnippets(): Promise<Snippet[]> {
  try {
      const response = await authedFetch(`${API_BASE}/snippets`);
    if (!response.ok) return [];
    const data = (await response.json()) as { snippets?: Snippet[] };
    return data.snippets ?? [];
  } catch {
    return [];
  }
}

export async function getActiveSessions(): Promise<ActiveSession[]> {
  const response = await authedFetch(`${APP_ORIGIN}/api/companion/sessions`);
  const data = await handleResponse<{ sessions?: ActiveSession[] }>(response);
  return data.sessions ?? [];
}

export async function revokeActiveSession(action: 'current' | 'all' | 'revoke', id?: string): Promise<'ok' | 'reauth'> {
  const response = await authedFetch(`${APP_ORIGIN}/api/companion/sessions`, {
    method: 'POST',
    body: JSON.stringify({ action, ...(id ? { id } : {}) }),
  });
  if (response.status === 428) return 'reauth';
  await handleResponse<unknown>(response);
  return 'ok';
}
