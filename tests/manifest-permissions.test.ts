/**
 * Audit EXT-14: no permission the code does not use, and a minimum Chrome that
 * supports sidePanel.open. Audit XP-16: staging and preview builds must be able
 * to receive the sign-in handoff.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
// @ts-expect-error plain ESM build script without type declarations
import { patchManifestForHost } from '../scripts/manifest-patch.mjs';

const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));

describe('manifest permissions', () => {
  it('does not request tabs or activeTab', () => {
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('activeTab');
  });

  it('requires Chrome 116+, where sidePanel.open exists', () => {
    expect(manifest.minimum_chrome_version).toBe('116');
  });

  it('still requests every permission the code relies on', () => {
    for (const permission of ['storage', 'sidePanel', 'alarms', 'webNavigation', 'scripting']) {
      expect(manifest.permissions).toContain(permission);
    }
  });
});

describe('staging manifest patch', () => {
  it('adds the preview host to the sign-in handoff content script', () => {
    const { manifest: patched, matchPattern } = patchManifestForHost(manifest, 'https://pranan-app-git-feat-x.vercel.app');
    expect(matchPattern).toBe('https://pranan-app-git-feat-x.vercel.app/*');
    const handoff = patched.content_scripts.find((s: { js: string[] }) => s.js.includes('content/pranan-app.js'));
    expect(handoff.matches).toEqual(['https://app.pranan.ai/*', matchPattern]);
    expect(patched.host_permissions).toContain(matchPattern);
    expect(patched.externally_connectable.matches).toContain(matchPattern);
    const gmail = patched.content_scripts.find((s: { js: string[] }) => s.js.includes('content/gmail.js'));
    expect(gmail.matches).toEqual(['https://mail.google.com/*']);
  });

  it('does not modify the source manifest', () => {
    patchManifestForHost(manifest, 'https://staging.pranan.ai');
    expect(manifest.host_permissions).not.toContain('https://staging.pranan.ai/*');
  });
});
