import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('service worker token cleanup', () => {
  it('does not clear authToken without refreshToken on invalid-auth paths', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/background/service-worker.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/remove\(\s*['"]authToken['"]\s*\)/);
    expect(source).not.toMatch(/remove\(\s*\[\s*['"]authToken['"]\s*\]\s*\)/);
    expect(source).toContain("remove(['authToken', 'refreshToken'])");
  });
});
