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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = 'https://app.pranan.ai/api/companion';

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
      throw new ApiError('Rate limit exceeded. Please wait a moment.', 429, 'RATE_LIMITED');
    }
    if (response.status === 401) {
      throw new ApiError('Session expired. Please reconnect.', 401, 'UNAUTHORIZED');
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
  const response = await fetch(`${API_BASE}/auth`, { headers });
  return handleResponse<AuthResponse>(response);
}

// ---------------------------------------------------------------------------
// GET /api/companion/context -- relationship context for a contact
// ---------------------------------------------------------------------------

export async function getContactContext(
  params: { email?: string; name?: string }
): Promise<ContactContext> {
  const headers = await authHeaders();
  const query = new URLSearchParams();
  if (params.email) query.set('email', params.email);
  if (params.name) query.set('name', params.name);

  const response = await fetch(`${API_BASE}/context?${query}`, { headers });
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
}

export async function generateDraft(request: DraftRequest, signal?: AbortSignal): Promise<DraftResponse> {
  const headers = await authHeaders();
  console.log('[API] generateDraft: POST', `${API_BASE}/draft`, { hasAuth: !!headers['Authorization'] });
  const response = await fetch(`${API_BASE}/draft`, {
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
  const response = await fetch(`${API_BASE}/rewrite`, {
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
  const response = await fetch(`${API_BASE}/grammar`, {
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
    const response = await fetch(`${API_BASE}/briefings`, { headers });
    return safeJsonResponse<MeetingBriefing[]>(response, []);
  } catch {
    return [];
  }
}

// GET /api/companion/nudges -- follow-up nudges
export async function getNudges(): Promise<FollowUpNudge[]> {
  try {
    const headers = await authHeaders();
    const response = await fetch(`${API_BASE}/nudges`, { headers });
    return safeJsonResponse<FollowUpNudge[]>(response, []);
  } catch {
    return [];
  }
}

// GET /api/companion/decay-alerts -- relationship decay alerts
export async function getDecayAlerts(): Promise<DecayAlert[]> {
  try {
    const headers = await authHeaders();
    const response = await fetch(`${API_BASE}/decay-alerts`, { headers });
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
