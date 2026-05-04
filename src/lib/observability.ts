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
  Sentry.setUser(userId ? { id: userId, email: email || undefined } : null);
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
