/**
 * Map a failed-draft error to a clear, actionable message for the inline bar.
 *
 * QA (2026-06-12): the inline Generate path showed a generic "Draft failed to
 * generate. Try again." for ANY failure, hiding the real reason. The most
 * common one during heavy use is the per-user rate limit (HTTP 429), which the
 * user should be told about ("wait a couple minutes") rather than left guessing.
 * The api-client throws an ApiError carrying `.status`, so we can branch on it.
 */
import { appOwnedUrl, appUrl } from './config';

/** Where the user upgrades: the server's link when it is on the app, else billing. */
function billingUrl(err: unknown): string {
  const supplied = err && typeof err === 'object' && 'upgradeUrl' in err ? (err as { upgradeUrl: unknown }).upgradeUrl : undefined;
  return appOwnedUrl(supplied) || appUrl('/settings/billing');
}

function billingLink(err: unknown): string {
  return billingUrl(err).replace(/^https?:\/\//, '');
}

function statusOf(err: unknown): number | undefined {
  return err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
    ? (err as { status: number }).status
    : undefined;
}

/**
 * The one thing the user can do about a failed draft, for surfaces that can
 * show a real control. `message` is the copy to show beside the control; it
 * leaves out the address the control already carries.
 *
 * draftErrorMessage() stays the complete plain-text version (address spelled
 * out) for surfaces that can only show text.
 */
export type DraftErrorAction =
  | {
      kind: 'upgrade';
      /** Text on the button or link. */
      label: string;
      /** Opens in a new tab. Always on the Pranan app. */
      url: string;
      message: string;
    }
  | {
      /**
       * The session is over. There is no address to open: the surface starts
       * the extension's own sign-in handoff (BEGIN_COMPANION_LOGIN), because
       * signing in to the app in a tab the extension did not open does not
       * sign the extension in (audit EXT-09).
       */
      kind: 'sign_in';
      label: string;
      message: string;
    };

export const SIGN_IN_LABEL = 'Sign in to Pranan';

export function draftErrorAction(err: unknown): DraftErrorAction | null {
  // The plan's monthly draft quota is used up (XP-09). The address used to be
  // plain text in the error, which Gmail does not make clickable.
  if (statusOf(err) === 402) {
    return {
      kind: 'upgrade',
      label: 'Upgrade plan',
      url: billingUrl(err),
      message: "You have used this month's drafts on your plan. Upgrade to keep drafting.",
    };
  }
  if (statusOf(err) === 401) {
    return {
      kind: 'sign_in',
      label: SIGN_IN_LABEL,
      message: 'You are signed out of Pranan. Sign in to keep drafting. Your text has not changed.',
    };
  }
  return null;
}

export function draftErrorMessage(err: unknown): string {
  const status = statusOf(err);
  const code =
    err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined;

  // The plan's monthly draft quota is used up. This used to fall through to
  // "Try again", so users retried and never saw how to upgrade (XP-09).
  if (status === 402) {
    return `You have used this month's drafts on your plan. Upgrade at ${billingLink(err)} to keep drafting.`;
  }
  // Three different limits answer 429, and they need different advice (XP-31).
  if (status === 429 && code === 'DAILY_BUDGET') {
    return "You've reached today's AI usage limit. It resets at midnight UTC, or upgrade your plan for more.";
  }
  if (status === 429 && (code === 'AI_ERROR' || code === 'UPSTREAM_RATE_LIMITED')) {
    return 'The AI service is busy right now. Try again in a minute.';
  }
  if (status === 429) {
    return "You've hit the draft limit for now. Wait a couple of minutes and try again.";
  }
  if (status === 503 && code === 'AUTH_REFRESH_UNAVAILABLE') {
    return 'Pranan could not refresh your session just now. You are still signed in. Try again in a moment.';
  }
  if (status === 401) {
    // Text-only surfaces. It used to say "Open app.pranan.ai to sign back in",
    // which does not work: the extension only accepts a sign-in it started.
    return 'Your Pranan session expired. Click the Pranan icon in the Chrome toolbar to sign back in, then try again.';
  }
  if (status === 409) return 'This Gmail mailbox differs from your Pranan account. Switch to the matching mailbox or sign into Pranan with this account.';
  if (status === 503) {
    return 'The AI service is briefly unavailable. Try again in a moment.';
  }
  // A request that never came back. Without this branch the inline bar's own
  // 30s reset was the only thing the user ever saw, and its copy points at the
  // login page — so a stalled draft looked like a sign-in problem even with a
  // perfectly valid session (measured 29 Jul: /draft answered a direct call in
  // 4.4s while the extension showed "check you're signed in").
  const name = err && typeof err === 'object' && 'name' in err ? (err as { name: unknown }).name : undefined;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return 'That draft took too long and was stopped. Try Generate again.';
  }
  if (err instanceof TypeError) return 'Pranan could not connect. Check your connection and retry. Your draft has not changed.';
  return 'Draft failed to generate. Try again.';
}
