/**
 * A quiet "signed out" signal on the Pranan toolbar icon.
 *
 * When a session ran out, the worker used to open the toolbar popup by itself
 * over whatever page the user was on (audit 17 Oct 2026). Now the icon shows a
 * small "!" and its tooltip says why; the popup's own sign-in screen is one
 * click away. The badge clears on the next successful sign-in check.
 */

export const SIGNED_OUT_BADGE_TEXT = '!';
export const SIGNED_OUT_TITLE = 'Pranan for Chrome: signed out. Click to sign in again.';
export const DEFAULT_TITLE = 'Pranan for Chrome';

export async function showSignedOutBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
    await chrome.action.setBadgeText({ text: SIGNED_OUT_BADGE_TEXT });
    await chrome.action.setTitle({ title: SIGNED_OUT_TITLE });
  } catch { /* action API unavailable */ }
}

export async function clearSignedOutBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: DEFAULT_TITLE });
  } catch { /* action API unavailable */ }
}
