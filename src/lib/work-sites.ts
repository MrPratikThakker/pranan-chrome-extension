/**
 * Sites Pranan can learn from (Phase 3).
 *
 * The manifest asks for no extra site access up front. It lists
 * optional_host_permissions "https://*\/*", and each site is granted only
 * when the user adds it in the popup: Chrome shows its own prompt for that
 * one site. On a granted site a small "Remember this page" tab sits on the
 * right edge (src/content/learn), unless the user hid it there. Nothing is read until the user presses it, and then
 * only that page's visible text is sent (POST /api/companion/learn), which
 * the app turns into Memory inbox suggestions saved only on approval.
 *
 * Removing a site revokes Chrome's permission and unregisters the button
 * there. The mail, chat and sign-in sites listed below, and Pranan itself,
 * can never be added; the app refuses them too (keep BLOCKED_HOSTS in
 * pranan-app src/lib/web-learn.ts the same).
 */

/** Hosts that can never be added, and that a wildcard must not cover. */
export const BLOCKED_SITE_HOSTS: readonly string[] = [
  'mail.google.com',
  'accounts.google.com',
  'myaccount.google.com',
  'app.slack.com',
  'linkedin.com',
  'pranan.ai',
  'outlook.office.com',
  'outlook.live.com',
  'mail.yahoo.com',
  'proton.me',
  'icloud.com',
  'web.whatsapp.com',
  'web.telegram.org',
  'messenger.com',
  'discord.com',
  'teams.microsoft.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
];

/**
 * Suffixes shared by many unrelated sites. A pattern for one of these
 * ("https://*.co.uk/*") would cover every site under it, so they are refused.
 */
export const SHARED_SUFFIXES: readonly string[] = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in',
  'co.nz', 'co.za', 'co.jp', 'com.br', 'com.mx', 'com.sg', 'com.hk', 'com.cn', 'com.tr', 'co.kr',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net',
  'amazonaws.com', 'blogspot.com', 'wordpress.com', 'substack.com', 'notion.site', 'webflow.io',
];

/** Origins the manifest always holds; never shown or removed as learning sites. */
export const BUILT_IN_ORIGINS: readonly string[] = [
  'https://mail.google.com/*',
  'https://app.slack.com/*',
  'https://www.linkedin.com/*',
  'https://app.pranan.ai/*',
];

export const LEARN_SCRIPT_ID = 'pranan-learn';

export interface SiteChoice {
  /** The Chrome match pattern granted, e.g. "https://*.notion.so/*". */
  pattern: string;
  /** What the user sees, e.g. "notion.so". */
  host: string;
}

export type SiteInputResult = { ok: true; site: SiteChoice } | { ok: false; reason: string };

/**
 * Pure: turn what the user typed ("notion.so", "https://www.notion.so/acme")
 * into the pattern to request. The pattern covers the site and its
 * subdomains, so it is refused when it would also cover a blocked host
 * (typing "google.com" would cover Gmail).
 */
export function siteFromInput(input: string): SiteInputResult {
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, reason: 'Type a site, for example notion.so.' };
  let host: string;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:') return { ok: false, reason: 'Only https sites can be added.' };
    host = url.hostname;
  } catch {
    return { ok: false, reason: 'That does not look like a website address.' };
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^[\d.]+$/.test(host)) {
    return { ok: false, reason: 'That does not look like a website address.' };
  }
  if (SHARED_SUFFIXES.includes(host)) {
    return { ok: false, reason: `${host} covers many unrelated sites. Add the exact site, for example acme.${host}.` };
  }
  const blocked = BLOCKED_SITE_HOSTS.find((b) => b === host || b.endsWith(`.${host}`) || host.endsWith(`.${b}`));
  if (blocked) return { ok: false, reason: `Pranan does not read ${host}. Mail, chat and sign-in sites stay out of bounds.` };
  return { ok: true, site: { pattern: `https://*.${host}/*`, host } };
}

/** Pure: the learning sites among the origins Chrome reports as granted. */
export function learningSites(origins: readonly string[] | undefined): SiteChoice[] {
  const seen = new Set<string>();
  const out: SiteChoice[] = [];
  for (const pattern of origins || []) {
    if (BUILT_IN_ORIGINS.includes(pattern)) continue;
    const m = /^https:\/\/(?:\*\.)?([a-z0-9.-]+)\/\*$/.exec(pattern);
    if (!m || seen.has(pattern)) continue;
    seen.add(pattern);
    out.push({ pattern, host: m[1] });
  }
  return out.sort((a, b) => a.host.localeCompare(b.host));
}

/** Pure: may this page be learned from? Same rules as the app. */
export function isLearnablePageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return !BLOCKED_SITE_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
  } catch {
    return false;
  }
}

export async function listLearningSites(): Promise<SiteChoice[]> {
  const all = await chrome.permissions.getAll();
  return learningSites(all.origins);
}

/** Must run from a click: Chrome shows its own prompt for this one site. */
export async function addLearningSite(site: SiteChoice): Promise<boolean> {
  return chrome.permissions.request({ origins: [site.pattern] });
}

export async function removeLearningSite(site: SiteChoice): Promise<boolean> {
  return chrome.permissions.remove({ origins: [site.pattern] });
}

/**
 * Keep the "Remember this page" script registered on exactly the granted
 * learning sites. Called by the service worker on start-up and whenever a
 * permission is added or removed.
 */
export async function syncLearnScript(): Promise<string[]> {
  const patterns = (await listLearningSites()).map((s) => s.pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [LEARN_SCRIPT_ID] });
  if (patterns.length === 0) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [LEARN_SCRIPT_ID] });
    return [];
  }
  const script = { id: LEARN_SCRIPT_ID, matches: patterns, js: ['content/learn.js'], runAt: 'document_idle' as const, allFrames: false, persistAcrossSessions: true };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  return patterns;
}

// ---------------------------------------------------------------------------
// "Hide on this site"
//
// The button used to come back on every page load after the user closed it.
// Now its "Hide on this site" is kept in chrome.storage.local as a list of
// hosts: the learning site the page belongs to ("notion.so"), or the page's
// own host when no site matches. The popup's site list can bring it back.
// ---------------------------------------------------------------------------

export const HIDDEN_LEARN_SITES_KEY = 'pranan.learnButtonHiddenHosts';

/** Pure: the host a page's hide choice is stored under. */
export function hideKeyForHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/** Pure: has the user hidden the button for this page's host (or a parent of it)? */
export function isLearnButtonHidden(hostname: string, hidden: readonly string[]): boolean {
  const host = hideKeyForHost(hostname);
  return hidden.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Pure: the hidden hosts that belong to a learning site, e.g. notion.so covers acme.notion.so. */
export function hiddenHostsForSite(site: SiteChoice, hidden: readonly string[]): string[] {
  return hidden.filter((h) => h === site.host || h.endsWith(`.${site.host}`));
}

/**
 * Pure: the learning site a page belongs to, so "Hide on this site" on
 * acme.notion.so hides the tab on every notion.so page the user added. The
 * most specific match wins when sites overlap.
 */
export function learningSiteForHost(hostname: string, sites: readonly SiteChoice[]): SiteChoice | null {
  const host = hideKeyForHost(hostname);
  const matches = sites.filter((s) => host === s.host || host.endsWith(`.${s.host}`));
  return matches.sort((a, b) => b.host.length - a.host.length)[0] ?? null;
}

function readHidden(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export async function getHiddenLearnHosts(): Promise<string[]> {
  const stored = await chrome.storage.local.get(HIDDEN_LEARN_SITES_KEY);
  return readHidden(stored[HIDDEN_LEARN_SITES_KEY]);
}

export async function hideLearnButtonOn(hostname: string): Promise<void> {
  const hidden = await getHiddenLearnHosts();
  const key = hideKeyForHost(hostname);
  if (!hidden.includes(key)) await chrome.storage.local.set({ [HIDDEN_LEARN_SITES_KEY]: [...hidden, key] });
}

/** Bring the button back everywhere on this learning site. */
export async function showLearnButtonOnSite(site: SiteChoice): Promise<void> {
  const hidden = await getHiddenLearnHosts();
  const drop = new Set(hiddenHostsForSite(site, hidden));
  await chrome.storage.local.set({ [HIDDEN_LEARN_SITES_KEY]: hidden.filter((h) => !drop.has(h)) });
}
