/**
 * Lightweight error capture for the extension.
 *
 * Until we install @sentry/browser this is a console.error stub. When ready:
 *   npm install @sentry/browser
 *   then replace the no-op below with Sentry.init({ dsn: SENTRY_DSN })
 *
 * Set VITE_SENTRY_DSN in .env.local at build time.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env: any = (import.meta as any).env || {};
const DSN: string = env.VITE_SENTRY_DSN || '';
const ENABLED = Boolean(DSN);

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
  // Sentry.captureException(error, { tags: { component: context?.component }, extra: context?.metadata });
}

export function captureMessage(message: string, context?: ErrorContext): void {
  console.log('[Pranan]', message, context);
  if (!ENABLED) return;
  // Sentry.captureMessage(message, { tags: { component: context?.component } });
}

export function setUser(userId: string | null, email?: string | null): void {
  if (!ENABLED) return;
  // Sentry.setUser(userId ? { id: userId, email: email || undefined } : null);
}
