/**
 * A real control inside an inline notice.
 *
 * Some failures have exactly one useful next step. Spelling the address out in
 * the notice ("Upgrade at app.pranan.ai/settings/billing") leaves the user to
 * retype it, because a notice is plain text. The worker now sends the step as
 * data (see draftErrorAction) and the surface renders it as a link styled like
 * that surface's own buttons.
 *
 * The link is an <a target="_blank">, so it opens a new tab with no extension
 * permission and no round trip to the worker.
 */

import { appOwnedUrl } from '@/lib/config';

export interface NoticeAction {
  kind: 'upgrade';
  label: string;
  url: string;
  /** Copy to show beside the control. */
  message: string;
}

/**
 * Validate an action that arrived in a message. Returns null for anything that
 * is not a known action pointing at the Pranan app, so a malformed or hostile
 * payload can never put a link to somewhere else in front of the user.
 */
export function readNoticeAction(value: unknown): NoticeAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'upgrade') return null;
  const url = appOwnedUrl(raw.url);
  if (!url) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Upgrade plan';
  const message = typeof raw.message === 'string' ? raw.message : '';
  return { kind: 'upgrade', label, url, message };
}

/** Matches the primary button in the Gmail compose popover. */
export const NOTICE_ACTION_STYLE = [
  'display:inline-flex', 'align-items:center', 'justify-content:center', 'flex:none',
  'box-sizing:border-box', 'height:30px', 'padding:0 12px', 'border:0', 'border-radius:8px',
  'background:#6d28d9', 'color:#fff', 'font-family:inherit', 'font-size:12px', 'font-weight:600',
  'line-height:1', 'text-decoration:none',
  'white-space:nowrap', 'cursor:pointer',
].join(';');

/** Build the link for a validated action. Opens the app in a new tab. */
export function createNoticeActionLink(action: NoticeAction, cssText: string = NOTICE_ACTION_STYLE): HTMLAnchorElement {
  const link = document.createElement('a');
  link.setAttribute('data-pranan-notice-action', action.kind);
  link.textContent = action.label;
  link.href = action.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.cssText = cssText;
  // Gmail listens for clicks on its own compose surface. Keep ours to ourselves;
  // this does not stop the browser following the link.
  link.addEventListener('click', (event) => event.stopPropagation());
  return link;
}
