/** UI placeholder/status text is not a recipient or a channel name. */
export function slackContextLabel(value: string | null | undefined): string | null {
  const label = value?.replace(/\s+/g, ' ').trim();
  if (!label) return null;
  if (/^(new message|new conversation|drafts?|direct messages?|saved(?: a moment ago| just now| \d+ (?:seconds?|minutes?|hours?) ago)?|saving(?:\.{3}|…)?|loading(?:\.{3}|…)?)$/i.test(label)) return null;
  return label;
}
