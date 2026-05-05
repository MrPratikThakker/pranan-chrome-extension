/**
 * Safe DOM construction for draft text injection.
 *
 * Replaces `node.innerHTML = userText.split('\n').map(...).join('')`
 * across content scripts. The draft text is server-generated (our
 * own backend) so the present risk is low, but defense-in-depth: the
 * moment the model paraphrases attacker-controlled content from an
 * email body, untrusted HTML reaches the editor. Using textContent
 * with explicit BR + element creation closes that vector forever.
 */

/**
 * Replaces the children of `node` with one block per line of `text`.
 * - Each non-empty line becomes a `<tag>line</tag>` block (tag defaults to 'div').
 * - Each empty line becomes a `<tag><br></tag>` block to preserve spacing.
 * - Line text is set via `textContent`, never `innerHTML`, so HTML
 *   in the source is rendered as literal text.
 */
export function injectMultilineText(
  node: HTMLElement,
  text: string,
  tag: 'div' | 'p' = 'div',
): void {
  // Clear existing children safely.
  while (node.firstChild) node.removeChild(node.firstChild);

  const lines = (text || '').split('\n');
  for (const line of lines) {
    const block = document.createElement(tag);
    if (!line) {
      block.appendChild(document.createElement('br'));
    } else {
      block.textContent = line;
    }
    node.appendChild(block);
  }
}
