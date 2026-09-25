/**
 * Error capture for the extension via Sentry browser SDK.
 *
 * Sentry only initializes when VITE_SENTRY_DSN is set at build time.
 * Without DSN, calls fall back to console.error so the call sites still
 * work in dev / unconfigured environments.
 *
 * Init is idempotent — safe to call from every entry point (service worker,
 * sidepanel, popup, content scripts).
 */

import * as Sentry from '@sentry/browser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env: any = (import.meta as any).env || {};
const DSN: string = env.VITE_SENTRY_DSN || '';
const RELEASE: string = env.VITE_SENTRY_RELEASE || env.VITE_APP_VERSION || 'unknown';
const ENVIRONMENT: string = env.MODE === 'production' ? 'production' : (env.MODE || 'development');
const ENABLED = Boolean(DSN);

let initialized = false;

function ensureInit(): void {
  if (initialized || !ENABLED) return;
  try {
    Sentry.init({
      dsn: DSN,
      release: RELEASE,
      environment: ENVIRONMENT,
      // Conservative defaults: errors only, no performance traces (extension
      // perf overhead matters more than perf telemetry to start).
      tracesSampleRate: 0,
      // Don't capture every console statement — extension content scripts
      // log a lot for debugging. We capture explicit calls only.
      defaultIntegrations: false,
      // Scrub personal data before anything leaves the browser (audit
      // EXT-20): no query strings (the /context lookup carries email
      // addresses and names), no response bodies, no request data.
      beforeSend(event) {
        return scrubEvent(event);
      },
      // Strip query strings + URL fragments from breadcrumbs (might contain
      // OAuth tokens during reconnect flows).
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.data && typeof breadcrumb.data.url === 'string') {
          try {
            const u = new URL(breadcrumb.data.url);
            breadcrumb.data.url = `${u.origin}${u.pathname}`;
          } catch {
            // ignore
          }
        }
        return breadcrumb;
      },
    });
    initialized = true;
  } catch (err) {
    console.warn('[Pranan] Sentry init failed:', err);
  }
}

/** Keep only origin + path. */
export function stripUrl(value: string): string {
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

const DROPPED_EXTRA_KEYS = new Set(['body', 'responseBody', 'text', 'draft', 'comment', 'email', 'name']);

/**
 * Remove personal data from a Sentry event: URL query strings and fragments,
 * request bodies, cookies and headers, and any extra field that could carry
 * message text. Exported for tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  const next = { ...event } as T & Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request = next.request as Record<string, any> | undefined;
  if (request) {
    const cleaned: Record<string, unknown> = {};
    if (typeof request.url === 'string') cleaned.url = stripUrl(request.url);
    if (typeof request.method === 'string') cleaned.method = request.method;
    (next as Record<string, unknown>).request = cleaned;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra = next.extra as Record<string, any> | undefined;
  if (extra && typeof extra === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(extra)) {
      if (DROPPED_EXTRA_KEYS.has(key)) continue;
      cleaned[key] = typeof value === 'string' && /^https?:\/\//.test(value) ? stripUrl(value) : value;
    }
    (next as Record<string, unknown>).extra = cleaned;
  }
  if (next.user && typeof next.user === 'object') {
    (next as Record<string, unknown>).user = { id: (next.user as { id?: unknown }).id };
  }
  return next;
}

interface ErrorContext {
  component?: string;
  user_action?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export function captureError(error: unknown, context?: ErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error('[Pranan]', message, context, stack);
  if (!ENABLED) return;
  ensureInit();
  Sentry.captureException(error, {
    tags: { component: context?.component },
    extra: { user_action: context?.user_action, ...(context?.metadata || {}) },
  });
}

export function captureMessage(message: string, context?: ErrorContext): void {
  console.log('[Pranan]', message, context);
  if (!ENABLED) return;
  ensureInit();
  Sentry.captureMessage(message, {
    tags: { component: context?.component },
    extra: { user_action: context?.user_action, ...(context?.metadata || {}) },
  });
}

export function setUser(userId: string | null, email?: string | null): void {
  if (!ENABLED) return;
  ensureInit();
  // Id only: an email address is personal data the error reports do not need.
  void email;
  Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Add a breadcrumb for context (shown alongside future errors).
 * Useful for tracing user actions before an error fires.
 */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!ENABLED) return;
  ensureInit();
  Sentry.addBreadcrumb({ message, data, level: 'info' });
}

/**
 * Surface-aware bootstrap. Call once from each entry point (service
 * worker, sidepanel, popup, content scripts) so Sentry initializes per
 * context, knows which surface it's running in, and captures uncaught
 * errors + unhandled promise rejections.
 *
 * Idempotent. Safe to call multiple times within a single context.
 */
type Surface = 'service-worker' | 'sidepanel' | 'popup' | 'content-gmail' | 'content-slack' | 'content-linkedin';

let surfaceBootstrapped = false;

export function bootstrapSentry(surface: Surface): void {
  if (surfaceBootstrapped) return;
  surfaceBootstrapped = true;

  ensureInit();
  if (!ENABLED) return;

  Sentry.setTag('surface', surface);

  // Service workers and content scripts have window in some contexts but
  // not others. Guard each handler.
  try {
    if (typeof self !== 'undefined' && 'addEventListener' in self) {
      self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        captureError(event.reason ?? new Error('unhandledrejection'), {
          component: surface,
          user_action: 'unhandledrejection',
        });
      });
    }
  } catch {
    // ignore
  }
  try {
    // Content scripts share `window` with Gmail, Slack and LinkedIn, so a
    // window error listener there reports THEIR page errors as ours (audit
    // EXT-20). Only the extension's own pages listen.
    if (typeof window !== 'undefined' && !surface.startsWith('content-')) {
      window.addEventListener('error', (event: ErrorEvent) => {
        captureError(event.error || new Error(event.message), {
          component: surface,
          user_action: 'window.onerror',
        });
      });
    }
  } catch {
    // ignore
  }
}
