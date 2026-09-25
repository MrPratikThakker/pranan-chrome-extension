/**
 * Pure manifest patch for staging and preview builds, shared by
 * build-manifest.mjs and its test.
 *
 * Adds the target origin to host_permissions and externally_connectable, AND
 * to the content script that receives the sign-in handoff. Without the last
 * one, nothing listened on a staging or preview host, so those builds could
 * never sign in and auth changes shipped untested (audit XP-16).
 */

export const PROD_ORIGIN = 'https://app.pranan.ai';
const PROD_MATCH = `${PROD_ORIGIN}/*`;

export function patchManifestForHost(manifest, target) {
  const parsed = new URL(target);
  const matchPattern = `${parsed.protocol}//${parsed.host}/*`;
  const next = structuredClone(manifest);

  next.host_permissions = Array.from(new Set([...(next.host_permissions || []), matchPattern]));

  if (next.externally_connectable?.matches) {
    next.externally_connectable.matches = Array.from(
      new Set([...next.externally_connectable.matches, matchPattern])
    );
  }

  for (const script of next.content_scripts || []) {
    const isAppHandoff = (script.js || []).includes('content/pranan-app.js')
      || (script.matches || []).includes(PROD_MATCH);
    if (isAppHandoff) {
      script.matches = Array.from(new Set([...(script.matches || []), matchPattern]));
    }
  }

  // Tag the manifest so it's obvious in chrome://extensions that this is a
  // non-prod build.
  const versionSuffix = parsed.host.replace(/\./g, '-');
  next.name = `${next.name} (${parsed.host})`;
  next.version_name = `${next.version} (${versionSuffix})`;

  return { manifest: next, matchPattern };
}
