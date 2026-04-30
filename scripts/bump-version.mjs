#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const arg = process.argv[2];
if (!arg) { console.error('Usage: bump-version.mjs <patch|minor|major|x.y.z>'); process.exit(1); }

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf-8'));

const current = pkg.version.split('.').map(Number);
let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg.split('.').map(Number);
else if (arg === 'patch') next = [current[0], current[1], current[2] + 1];
else if (arg === 'minor') next = [current[0], current[1] + 1, 0];
else if (arg === 'major') next = [current[0] + 1, 0, 0];
else { console.error(`Unknown bump: ${arg}`); process.exit(1); }

const nextStr = next.join('.');
pkg.version = nextStr;
manifest.version = nextStr;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
writeFileSync('public/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Bumped ${current.join('.')} → ${nextStr}`);
console.log(`Next: git commit -am "release: v${nextStr}" && git tag v${nextStr} && git push --follow-tags`);
