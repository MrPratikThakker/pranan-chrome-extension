/**
 * Pranan Companion API Client
 *
 * Typed client for all /api/companion/* endpoints.
 * Runs in both service worker and side panel contexts.
 * Supports SSE streaming for draft generation.
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
} from '@/types';

import { captureError } from '@/lib/observability';

// Module-level flag to dedup parallel 401 cleanup. See handleResponse 401 branch.
let authExpiryInFlight = false;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

import { API_BASE } from './config';

// ---------------------------------------------------------------------------
// Token management (reads from chrome.storage.local for persistence across restarts)
// ---------------------------------------------------------------------------

async function getAuthToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get('authToken');
    return result.authToken || null;
  } catch {
    return null;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
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
 *
 * Streaming requests (SSE) cannot be retried mid-stream and should not call
 * this helper for the streaming fetch itself; they can fall back to the
 * non-streaming path which DOES retry.
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
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    let message = `API error: ${response.status}`;
    let code: string | undefined;

    try {
      const parsed = JSON.parse(body);
      message = parsed.error || parsed.message || message;
      code = parsed.code;
    } catch {
      // Use default message
    }

    if (response.status === 429) {
      const err = new ApiError('Rate limit exceeded. Please wait a moment.', 429, 'RATE_LIMITED');
      captureError(err, { component: 'api-client', metadata: { status: 429, url: response.url } });
      throw err;
    }
    if (response.status === 401) {
      // Auth expired. Dedup so concurrent 401s (briefings + nudges + decay
      // alerts firing in parallel) only trigger one cleanup + one broadcast.
      if (!authExpiryInFlight) {
        authExpiryInFlight = true;
        try { await chrome.storage.local.remove('authToken'); } catch { /* pass */ }
        try {
          chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' });
        } catch { /* pass — sender may not be a content script */ }
        // Reset the flag after a short window so future 401s (e.g. after
        // re-auth then a server hiccup) still trigger the cleanup.
        setTimeout(() => { authExpiryInFlight = false; }, 5000);
      }
      const err = new ApiError('Session expired. Please reconnect.', 401, 'UNAUTHORIZED');
      captureError(err, { component: 'api-client', metadata: { url: response.url } });
      throw err;
    }
    if (response.status >= 500) {
      const err = new ApiError(message, response.status, code);
      captureError(err, { component: 'api-client', metadata: { status: response.status, url: response.url, body: body.slice(0, 500) } });
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
  const headers = await authHeaders();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth`, { headers });
  } catch (e) {
    // Network error: don't sign the user out; treat as transient.
    console.warn('[API] validateAuth: network error, treating as transient', e);
    return { valid: true, transient: true } as unknown as AuthResponse;
  }
  // Server signaling transient failure (503 with transient flag, e.g. Supabase
  // blip). Don't clear the token; let the next call retry.
  if (response.status === 503) {
    console.warn('[API] validateAuth: 503 from server, treating as transient');
    return { valid: true, transient: true } as unknown as AuthResponse;
  }
  return handleResponse<AuthResponse>(response);
}

// ---------------------------------------------------------------------------
// GET /api/companion/context -- relationship context for a contact
// ---------------------------------------------------------------------------

export async function getContactContext(
  params: { email?: string; name?: string; linkedinUrl?: string }
): Promise<ContactContext> {
  const headers = await authHeaders();
  const query = new URLSearchParams();
  if (params.email) query.set('email', params.email);
  if (params.name) query.set('name', params.name);
  if (params.linkedinUrl) query.set('linkedinUrl', params.linkedinUrl);

  const response = await fetchWithRetry(`${API_BASE}/context?${query}`, { headers });
  return handleResponse<ContactContext>(response);
}

// ---------------------------------------------------------------------------
// POST /api/companion/draft -- generate a draft (supports SSE streaming)
// ---------------------------------------------------------------------------

export interface DraftRequest {
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
}

export async function generateDraft(request: DraftRequest, signal?: AbortSignal): Promise<DraftResponse> {
  const headers = await authHeaders();
  console.log('[API] generateDraft: POST', `${API_BASE}/draft`, { hasAuth: !!headers['Authorization'] });
  const response = await fetchWithRetry(`${API_BASE}/draft`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  });
  console.log('[API] generateDraft: response status', response.status);
  return handleResponse<DraftResponse>(response);
}

/**
 * Stream a draft via SSE for progressive rendering.
 * Yields partial text chunks as they arrive.
 *
 * If the server responds with plain JSON (no SSE), we detect it via
 * Content-Type and yield a single 'done' event with the full response.
 * This makes streaming a transparent upgrade -- works whether or not
 * the server supports it.
 */
export async function* streamDraft(
  request: DraftRequest,
  signal?: AbortSignal
): AsyncGenerator<{ type: 'chunk' | 'done'; text: string; meta?: Partial<DraftResponse> }> {
  const headers = await authHeaders();
  headers['Accept'] = 'text/event-stream';

  console.log('[API] streamDraft: POST', `${API_BASE}/draft`, { hasAuth: !!headers['Authorization'], stream: true });
  const response = await fetch(`${API_BASE}/draft`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...request, stream: true }),
    signal,
  });

  const contentType = response.headers.get('content-type') || '';
  console.log('[API] streamDraft: response status', response.status, 'content-type', contentType);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[API] streamDraft: error body', body);
    throw new ApiError(`Draft stream failed: ${response.status}${body ? ` - ${body.slice(0, 200)}` : ''}`, response.status);
  }

  // ---- Server returned plain JSON (no SSE support) ----
  // Detect via Content-Type: if it's application/json, parse as a single DraftResponse
  if (contentType.includes('application/json')) {
    console.log('[API] streamDraft: server returned JSON (not SSE), yielding as single done event');
    const json = await response.json() as DraftResponse;
    yield {
      type: 'done',
      text: json.draft || '',
      meta: {
        confidence: json.confidence,
        voiceMatch: json.voiceMatch,
        alternativeTones: json.alternativeTones,
      },
    };
    return;
  }

  // ---- Server returned SSE stream ----
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('No response body', 500);

  const decoder = new TextDecoder();
  let buffer = '';

  // Wrap in try/finally so the reader is always released even if the consumer
  // aborts mid-stream or the connection drops. Without this, the underlying
  // body stays locked and subsequent fetches can hang.
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            yield parsed;
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already canceled */ }
    try { reader.releaseLock(); } catch { /* already released */ }
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
  const headers = await authHeaders();
  const response = await fetchWithRetry(`${API_BASE}/rewrite`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  });
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
  const headers = await authHeaders();
  const response = await fetchWithRetry(`${API_BASE}/grammar`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  });
  return handleResponse<GrammarResponse>(response);
}

// ---------------------------------------------------------------------------
// Phase 5: Intelligence Layer
// These endpoints are planned but not yet built on the server.
// Each function returns an empty array gracefully if the server 404s.
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
    const headers = await authHeaders();
    const response = await fetchWithRetry(`${API_BASE}/briefings`, { headers });
    return safeJsonResponse<MeetingBriefing[]>(response, []);
  } catch {
    return [];
  }
}

// GET /api/companion/nudges -- follow-up nudges
export async function getNudges(): Promise<FollowUpNudge[]> {
  try {
    const headers = await authHeaders();
    const response = await fetchWithRetry(`${API_BASE}/nudges`, { headers });
    return safeJsonResponse<FollowUpNudge[]>(response, []);
  } catch {
    return [];
  }
}

// GET /api/companion/decay-alerts -- relationship decay alerts
export async function getDecayAlerts(): Promise<DecayAlert[]> {
  try {
    const headers = await authHeaders();
    const response = await fetchWithRetry(`${API_BASE}/decay-alerts`, { headers });
    return safeJsonResponse<DecayAlert[]>(response, []);
  } catch {
    return [];
  }
}

// POST /api/companion/nudges/:id/dismiss -- dismiss a nudge
export async function dismissNudge(nudgeId: string): Promise<void> {
  const headers = await authHeaders();
  await fetch(`${API_BASE}/nudges/${nudgeId}/dismiss`, {
    method: 'POST',
    headers,
  });
}

// POST /api/companion/nudges/:id/draft -- generate draft from nudge
export async function draftFromNudge(nudgeId: string): Promise<DraftResponse> {
  const headers = await authHeaders();
  const response = await fetch(`${API_BASE}/nudges/${nudgeId}/draft`, {
    method: 'POST',
    headers,
  });
  return handleResponse<DraftResponse>(response);
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
    const headers = await authHeaders();
    const response = await fetch(`${API_BASE}/today`, { headers });
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
    const headers = await authHeaders();
    const response = await fetch(`${API_BASE}/snippets`, { headers });
    if (!response.ok) return [];
    const data = (await response.json()) as { snippets?: Snippet[] };
    return data.snippets ?? [];
  } catch {
    return [];
  }
}



