/**
 * Blank out comments before scanning source for invariants.
 *
 * Two scanners have now reported false positives because a comment DESCRIBED
 * the thing being checked: insert-ack.ts opens by explaining the sendMessage
 * bug it fixed, and the LinkedIn busy-state note quotes the very call it is
 * documenting. Blanks rather than deletes, so reported line numbers stay true.
 */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}
