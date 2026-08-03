import { describe, it, expect } from 'vitest';
import { usesDirectWorkerPath } from '../src/background/inline-draft-routing';

/**
 * Measured live on LinkedIn messaging, v0.8.48: pressed Generate on the inline
 * bar and nothing happened. Twenty-six seconds later the button still read
 * "Generate", the compose was empty, and no error had been shown.
 *
 * INLINE_DRAFT_REQUEST is routed by the service worker on this condition:
 *
 *   originSurface === 'inline-bar' && (platform === 'gmail' || platform === 'slack')
 *
 * LinkedIn is absent, so a LinkedIn inline draft falls through to the
 * side-panel handoff: open the panel, stash a pending request, broadcast after
 * 500ms. With the panel closed nothing receives it and the user gets silence.
 *
 * The comment directly above that condition reads:
 *
 *   "Gmail and LinkedIn were already migrated; Slack was the straggler."
 *
 * LinkedIn was never migrated. The comment describes exactly the failure it
 * still has -- "silently produced nothing when the panel was closed".
 *
 * LinkedIn comments were unaffected because they travel as
 * COMMENT_DRAFT_REQUEST, whose gate carries no platform restriction at all.
 * That is why commenting worked in the same session that messaging did not.
 */
describe('usesDirectWorkerPath', () => {
  it.each(['gmail', 'slack', 'linkedin'])(
    'routes the %s inline bar straight through the worker',
    (platform) => {
      expect(usesDirectWorkerPath({ originSurface: 'inline-bar', platform })).toBe(true);
    },
  );

  it('leaves non-inline surfaces on the side-panel path', () => {
    expect(usesDirectWorkerPath({ originSurface: 'sidepanel', platform: 'gmail' })).toBe(false);
    expect(usesDirectWorkerPath({ originSurface: 'popover', platform: 'linkedin' })).toBe(false);
  });

  it('does not route an unknown platform it cannot insert into', () => {
    expect(usesDirectWorkerPath({ originSurface: 'inline-bar', platform: 'whatsapp' })).toBe(false);
    expect(usesDirectWorkerPath({ originSurface: 'inline-bar' })).toBe(false);
  });

  it('survives a malformed payload rather than throwing in the worker', () => {
    expect(usesDirectWorkerPath(null)).toBe(false);
    expect(usesDirectWorkerPath(undefined)).toBe(false);
    expect(usesDirectWorkerPath({})).toBe(false);
  });
});
