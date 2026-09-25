#!/usr/bin/env node
/**
 * Post-build manifest patcher.
 *
 * vite copies public/manifest.json into dist/ verbatim. For non-prod
 * builds we want to add the staging or preview origin to host_permissions,
 * externally_connectable AND the sign-in handoff content script, so the
 * extension can talk to that host and sign in there (see manifest-patch.mjs).
 *
 * Usage:
 *   VITE_API_HOST=https://staging.pranan.ai node scripts/build-manifest.mjs
 *   VITE_API_HOST=https://pranan-app-git-feat-x.vercel.app node scripts/build-manifest.mjs
 *
 * If VITE_API_HOST is unset or equals the prod origin, this is a no-op.
 *
 * For manifest version 3, host_permissions accepts exact origins or
 * match patterns. We add the parsed origin as a wildcard pattern.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PROD_ORIGIN, patchManifestForHost } from './manifest-patch.mjs';

const target = process.env.VITE_API_HOST || PROD_ORIGIN;

if (target === PROD_ORIGIN) {
  console.log('[build-manifest] VITE_API_HOST is prod, no patch needed');
  process.exit(0);
}

try {
  new URL(target);
} catch {
  console.error(`[build-manifest] VITE_API_HOST is not a valid URL: ${target}`);
  process.exit(1);
}

const manifestPath = resolve('dist', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`[build-manifest] dist/manifest.json not found. Run vite build first.`);
  process.exit(1);
}

const { manifest, matchPattern } = patchManifestForHost(JSON.parse(readFileSync(manifestPath, 'utf-8')), target);

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[build-manifest] patched dist/manifest.json:`);
console.log(`  added host_permission: ${matchPattern}`);
console.log(`  added content script match: ${matchPattern}`);
console.log(`  name: ${manifest.name}`);
console.log(`  version_name: ${manifest.version_name}`);
