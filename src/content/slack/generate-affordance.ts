/**
 * Whether the Slack bar's Generate button can be seen and pressed.
 *
 * It used to be hidden until the user typed into Pranan's own prompt field:
 *
 *   const hasText = input.value.trim().length > 0;
 *   generateBtn.style.opacity = hasText ? '1' : '0';
 *   generateBtn.style.pointerEvents = hasText ? 'auto' : 'none';
 *
 * Measured live in a real Slack channel on v0.8.44: the bar renders a prompt
 * field and a dismiss "×", and Generate is `opacity: 0; pointer-events: none`.
 * Not clickable at any of five points across its own rect, and hovering the bar
 * does not reveal it. The only control a user can actually press is the one
 * that dismisses the feature.
 *
 * Gmail does not work this way. Its Generate is always live and drafts from
 * thread context with no prompt at all — that is the one-tap promise. Slack has
 * the same context to hand (getThreadContext / getRecentChannelMessages), so
 * requiring a typed prompt bought nothing and hid the primary action behind a
 * step nobody is told about. The prompt stays optional, exactly as on Gmail:
 * type to steer the draft, or press Generate and let the thread speak.
 */

export interface GenerateButtonState {
  opacity: string
  pointerEvents: string
}

/**
 * @param promptText current contents of the bar's prompt field, if any
 * @returns the styles to apply — always visible, always pressable
 */
export function generateButtonState(promptText?: string | null): GenerateButtonState {
  // promptText is accepted so call sites keep reading naturally, and so the
  // signature still fits if the button ever needs to reflect prompt state in
  // some way that is not "disappear".
  void promptText;
  return { opacity: '1', pointerEvents: 'auto' };
}
