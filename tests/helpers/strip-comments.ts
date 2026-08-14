/** Blank out comments before scanning source, so a comment describing the
 *  thing being checked cannot satisfy the check. Blanks rather than deletes,
 *  so reported line numbers stay true. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}
