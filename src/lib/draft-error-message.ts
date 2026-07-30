/**
 * Map a failed-draft error to a clear, actionable message for the inline bar.
 *
 * QA (2026-06-12): the inline Generate path showed a generic "Draft failed to
 * generate. Try again." for ANY failure, hiding the real reason. The most
 * common one during heavy use is the per-user rate limit (HTTP 429), which the
 * user should be told about ("wait a couple minutes") rather than left guessing.
 * The api-client throws an ApiError carrying `.status`, so we can branch on it.
 */
export function draftErrorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;

  if (status === 429) {
    return "You've hit the draft limit for now. Wait a couple of minutes and try again.";
  }
  if (status === 401) {
    return 'Your Pranan session expired. Open app.pranan.ai to sign back in, then try again.';
  }
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
  return 'Draft failed to generate. Try again.';
}
