import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import { stripComments } from './helpers/strip-comments';

describe('service worker token cleanup', () => {
  const source = stripComments(fs.readFileSync(
    path.join(process.cwd(), 'src/background/service-worker.ts'),
    'utf8',
  ));

  it('does not clear authToken without refreshToken on invalid-auth paths', () => {
    // Tokens are cleared only through clearAuthTokens(), which removes both
    // everywhere; the worker never removes one token on its own.
    expect(source).not.toMatch(/remove\(\s*['"]authToken['"]\s*\)/);
    expect(source).not.toMatch(/remove\(\s*\[\s*['"]authToken['"]\s*\]\s*\)/);
    expect(source).toContain('await clearAuthTokens();');
  });

  it('never keeps tokens in chrome.storage.local, which content scripts can read (EXT-10)', () => {
    expect(source).not.toMatch(/chrome\.storage\.local\.(set|get|remove)\([^)]*(authToken|refreshToken)/);
  });
});
