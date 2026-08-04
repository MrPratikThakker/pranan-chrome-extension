import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { stripComments } from './helpers/strip-comments';

const SRC = resolve(__dirname, '../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p)
      : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/**
 * chrome.*.sendMessage returns a promise that REJECTS with "Could not establish
 * connection. Receiving end does not exist." whenever nothing is listening.
 * For a broadcast from the service worker that is the normal case, because the
 * popup and side panel are closed almost all the time.
 *
 * The trap: wrapping the call in try/catch does not help. try/catch only
 * catches a synchronous throw; the rejection escapes it and lands in the
 * console as "Uncaught (in promise)" with a useless `background.js:0` stack.
 * That is exactly what was showing on chrome://extensions, and two calls in
 * api-client.ts looked defensive while being nothing of the sort.
 *
 * Every call must therefore be awaited, chained with .catch(), or use the
 * callback form (which reports via chrome.runtime.lastError instead).
 */
describe('no sendMessage call can leak an unhandled rejection', () => {
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const re = /chrome\.(runtime|tabs)\.sendMessage\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      // Walk to the matching close paren so we can see the whole call.
      let depth = 1, i = re.lastIndex;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      const call = src.slice(m.index, i);
      const after = src.slice(i, i + 40);
      const before = src.slice(Math.max(0, m.index - 90), m.index);

      const chained   = /^\s*\.catch\s*\(/.test(after) || /^\s*\.then\s*\(/.test(after);
      const awaited   = /\bawait\s*$/.test(before) || /\breturn\s*$/.test(before);
      // callback form: a trailing function argument
      const callback  = /,\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(call) || /,\s*function\s*\(/.test(call);

      if (!chained && !awaited && !callback) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${relative(SRC, file)}:${line}`);
      }
    }
  }

  it('every call is awaited, .catch()-ed, or callback-style', () => {
    expect(offenders).toEqual([]);
  });
});
