/**
 * Pure, DOM-free parsing of a LinkedIn feed post's visible innerText.
 *
 * LinkedIn migrated the feed to fully hashed CSS class names, so semantic
 * selectors no longer work. We instead parse the post's visible line structure,
 * which is far more stable. Kept in its own side-effect-free module so it can be
 * unit-tested without importing the content script's DOM bootstrap.
 */

export const LI_NOISE_LINE = /^(feed post|promoted|promoted by .*|follow|following|connect|•.*|\d+(st|nd|rd|th)|\d+[smhdw]( •.*)?|like|comment|repost|send|save|activate to view.*|.*reactions?$|load more comments|see (more|less)|… ?more|edited|[\d.,]+|​)$/i;

// A short line at the very top of a resurfaced item explaining why it is in the
// feed, e.g. "Justin Welsh commented on this" / "Ann reposted this". Kept short
// and end-anchored so it never matches body prose that merely uses the words.
const LI_RESURFACE_CONTEXT = /^.{1,44}\b(commented|reposted|replied)( on this| to this)?$/i;

// "...and 33 other connections follow this Page" social-proof rows and company
// follower-count lines. Never the author, never body.
const LI_FOLLOW_CONTEXT = /(follow this (page|newsletter)|and \d+ other (connection|connections|people))/i;
const LI_FOLLOWERS_LINE = /^[\d,.]+\s*followers?$/i;

export function parseLinkedInPostText(raw: string): { author: string | null; body: string | null } {
  let lines = (raw || '').split('\n').map((t) => t.trim()).filter(Boolean);
  // Drop the comments section so existing comments are never ingested as the post.
  const headerIdx = lines.findIndex((l) => /^(most relevant|most recent|top comments|add a comment)\b/i.test(l));
  if (headerIdx > 0) lines = lines.slice(0, headerIdx);

  // A resurface line ("X commented on this") only ever sits in the first couple
  // of lines. Capture it there so it is never mistaken for the author or body.
  const topContext = new Set<string>();
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    if (LI_RESURFACE_CONTEXT.test(lines[i])) topContext.add(lines[i]);
  }

  const isNoise = (l: string) => LI_NOISE_LINE.test(l);
  const isSocial = (l: string) =>
    LI_FOLLOW_CONTEXT.test(l) || LI_FOLLOWERS_LINE.test(l) || topContext.has(l);
  const skip = (l: string) => isNoise(l) || isSocial(l);

  // --- Author ---
  let author: string | null = null;
  // 1) Explicit "Feed post" marker: author is the first following line that is
  //    not UI noise or a social-context line (skips "X commented", follow rows).
  const fpi = lines.findIndex((l) => /^feed post$/i.test(l));
  if (fpi >= 0) {
    for (let i = fpi + 1; i < Math.min(fpi + 6, lines.length); i++) {
      if (!skip(lines[i])) { author = lines[i]; break; }
    }
  }
  // 2) Company Page post: the actor block is "<Page name>" then "<N> followers".
  //    Take the nearest real line before the followers line.
  if (!author) {
    const fi = lines.findIndex((l) => LI_FOLLOWERS_LINE.test(l));
    if (fi > 0) {
      for (let i = fi - 1; i >= 0; i--) {
        if (!skip(lines[i])) { author = lines[i]; break; }
      }
    }
  }
  // 3) Fallback: first line that is neither UI noise nor a social-context line.
  if (!author) {
    author = lines.find((l) => !skip(l)) || null;
  }

  // --- Body: everything that is not the author, UI noise, or a social line. ---
  const body = lines
    .filter((l) => l !== author && !isNoise(l) && !isSocial(l))
    .join('\n')
    .trim();

  return { author: author || null, body: body || null };
}
