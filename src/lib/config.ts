/**
 * Pranan Companion -- runtime config.
 *
 * Single source of truth for the API host, web app host, and other
 * environment-driven values. Override via Vite envs at build time:
 *
 *   VITE_API_HOST=https://staging.pranan.ai npm run build
 *
 * If the env isn't set, defaults to the production host.
 *
 * IMPORTANT: hardcoded URLs across source were the previous pattern;
 * if you need a new endpoint, add it here, not at the call site.
 */

const ENV_HOST = (import.meta as { env?: { VITE_API_HOST?: string } }).env?.VITE_API_HOST;

/** Base origin for the Pranan web app (login, settings, dashboard). */
export const APP_ORIGIN: string = ENV_HOST || 'https://app.pranan.ai';

/** Companion API base. Always under /api/companion on the same origin. */
export const API_BASE: string = `${APP_ORIGIN}/api/companion`;

/** Convenience: build a full app URL for a given path. */
export function appUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return `${APP_ORIGIN}${path}`;
}

/** Convenience: companion API URL. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return `${API_BASE}${path}`;
}
