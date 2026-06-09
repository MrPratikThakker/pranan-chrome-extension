/**
 * Pure, DOM-free parsing of a LinkedIn feed post's visible innerText.
 *
 * LinkedIn migrated the feed to fully hashed CSS class names, so semantic
 * selectors no longer work. We instead parse the post's visible line structure,
 * which is far more stable. Kept in its own side-effect-free module so it can be
 * unit-tested without importing the content script's DOM bootstrap.
 */

export const LI_NOISE_LINE = /^(feed post|promoted|promoted by .*|follow|following|connect|•.*|\d+(st|nd|rd|th)|\d+[smhdw]( •.*)?|like|comment|repost|send|save|activate to view.*|.*reactions?$|load more comments|see (more|less)|… ?more|edited|[\d.,]+|​)$/i;

export function parseLinkedInPostText(raw: string): { author: string | null; body: string | null } {
  let lines = (raw || '').split('\n').map((t) => t.trim()).filter(Boolean);
  // Drop the comments section so existing comments are never ingested as the post.
  const headerIdx = lines.findIndex((l) => /^(most relevant|most recent|top comments|add a comment)\b/i.test(l));
  if (headerIdx > 0) lines = lines.slice(0, headerIdx);
  let author: string | null = null;
  const fpi = lines.findIndex((l) => /^feed post$/i.test(l));
  if (fpi >= 0 && lines[fpi + 1]) author = lines[fpi + 1];
  const body = lines.filter((l) => !LI_NOISE_LINE.test(l) && l !== author).join('\n').trim();
  return { author: author || null, body: body || null };
}
