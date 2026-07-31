import { describe, it, expect } from 'vitest';
import { attributeSlackThread, attributeLinkedInHistory } from '../src/content/shared/thread-attribution';

/**
 * The same defect that produced a wrong-side draft in Gmail, still live on the
 * other two surfaces.
 *
 * Gmail's getThreadContext used to glue the last few messages together with
 * `---` and no sender on any of them. With nothing to distinguish the user's own
 * words from the counterparty's, the model answered whatever came last — so on a
 * live pricing thread where Pratik (the buyer) had asked "Can we do $15/user/
 * month?", Pranan drafted "Yes, we can offer $15/user/month". Fixed in v0.8.43.
 *
 * Slack and LinkedIn were never touched:
 *
 *   slack/index.ts getThreadContext()   -> .map(textContent).join('\n---\n')
 *   linkedin/index.ts getMessageHistory() -> .map(textContent).join('\n---\n')
 *
 * Slack is the sharper case. getRecentChannelMessages() in the SAME file already
 * attributes correctly (`${sender}: ${text}`), but every draft call site prefers
 * thread context when a thread is open — `threadContext || channelContext` — so
 * the attributed path is the one that loses.
 */

const html = (markup: string) => {
  document.body.innerHTML = markup;
  return document.body;
};

// A Slack thread pane: Grace asks, Pratik answers, Grace follows up.
const SLACK_THREAD = `
  <div data-qa="threads_flexpane">
    <div class="c-message_kit__message">
      <button data-qa="message_sender_name">Grace Robinson</button>
      <div class="c-message__body">Can you do $15 a seat?</div>
    </div>
    <div class="c-message_kit__message">
      <button data-qa="message_sender_name">Pratik Thakker</button>
      <div class="c-message__body">Let me check with the team.</div>
    </div>
    <div class="c-message_kit__message">
      <button data-qa="message_sender_name">Grace Robinson</button>
      <div class="c-message__body">Any update on that?</div>
    </div>
  </div>`;

describe('attributeSlackThread', () => {
  it('labels every message with who sent it', () => {
    html(SLACK_THREAD);
    const out = attributeSlackThread('Pratik Thakker') || '';
    expect(out).toContain('Grace Robinson');
    expect(out).toContain('Can you do $15 a seat?');
    expect(out).toContain('Any update on that?');
  });

  it('marks the user\'s own turns as theirs, not as the other party', () => {
    html(SLACK_THREAD);
    const out = attributeSlackThread('Pratik Thakker') || '';
    // The user's own line must be attributed to them and not to Grace.
    const ownLine = out.indexOf('Let me check with the team.');
    const labelBefore = out.lastIndexOf('From:', ownLine);
    expect(out.slice(labelBefore, ownLine)).toMatch(/you/i);
  });

  it('still attributes by name when the user is unknown', () => {
    html(SLACK_THREAD);
    const out = attributeSlackThread(null) || '';
    expect(out).toContain('Grace Robinson');
    expect(out).toContain('Pratik Thakker');
  });

  // The regression itself: a bare join with no speaker anywhere.
  it('never emits an unattributed transcript', () => {
    html(SLACK_THREAD);
    const out = attributeSlackThread('Pratik Thakker') || '';
    expect(out).not.toBe('Can you do $15 a seat?\n---\nLet me check with the team.\n---\nAny update on that?');
    expect((out.match(/From:/g) || []).length).toBe(3);
  });

  it('returns null when there is no thread pane open', () => {
    html('<div class="something-else"></div>');
    expect(attributeSlackThread('Pratik Thakker')).toBeNull();
  });

  it('falls back gracefully when a message has no sender element', () => {
    html(`
      <div data-qa="threads_flexpane">
        <div class="c-message_kit__message">
          <div class="c-message__body">Orphan message with no sender.</div>
        </div>
      </div>`);
    const out = attributeSlackThread('Pratik Thakker') || '';
    expect(out).toContain('Orphan message with no sender.');
    expect(out).toContain('From:');
  });
});

// LinkedIn groups consecutive messages under one sender heading.
const LINKEDIN_THREAD = `
  <div class="msg-s-message-list-content">
    <div class="msg-s-message-group">
      <span class="msg-s-message-group__name">Grace Robinson</span>
      <div class="msg-s-message-group__content">
        <p class="msg-s-event-listitem__body">Are you open to a chat?</p>
      </div>
    </div>
    <div class="msg-s-message-group">
      <span class="msg-s-message-group__name">Pratik Thakker</span>
      <div class="msg-s-message-group__content">
        <p class="msg-s-event-listitem__body">Sure — send a time.</p>
      </div>
    </div>
  </div>`;

describe('attributeLinkedInHistory', () => {
  it('labels every message with who sent it', () => {
    html(LINKEDIN_THREAD);
    const out = attributeLinkedInHistory('Pratik Thakker') || '';
    expect(out).toContain('Grace Robinson');
    expect(out).toContain('Are you open to a chat?');
    expect(out).toContain('Sure — send a time.');
  });

  it('marks the user\'s own turns as theirs', () => {
    html(LINKEDIN_THREAD);
    const out = attributeLinkedInHistory('Pratik Thakker') || '';
    const ownLine = out.indexOf('Sure — send a time.');
    const labelBefore = out.lastIndexOf('From:', ownLine);
    expect(out.slice(labelBefore, ownLine)).toMatch(/you/i);
  });

  it('never emits an unattributed transcript', () => {
    html(LINKEDIN_THREAD);
    const out = attributeLinkedInHistory('Pratik Thakker') || '';
    expect((out.match(/From:/g) || []).length).toBe(2);
  });

  it('returns null on an empty conversation', () => {
    html('<div class="msg-s-message-list-content"></div>');
    expect(attributeLinkedInHistory('Pratik Thakker')).toBeNull();
  });
});

/**
 * Measured live in Slack on v0.8.45, in a real thread.
 *
 * The thread pane was open and full of messages, and getThreadContext()
 * returned NOTHING — because threadMessageBody was a chain of exactly one
 * entry, `.c-message__body`, which matches zero elements in Slack's current
 * thread DOM. Counted in the open pane:
 *
 *   .c-message__body          0
 *   [data-qa="message-text"]  6
 *   .p-rich_text_section      6
 *
 * Every draft therefore fell through to `threadContext || channelContext` and
 * drafted from the CHANNEL. Measured side by side: the thread was about an
 * expired password reset, while the channel's recent messages were about not
 * marking mail as spam. A reply written from the wrong conversation entirely.
 *
 * A registry chain of one cannot degrade. That is the whole point of the chain.
 */
describe('attributeSlackThread against current Slack markup', () => {
  it('reads a thread that uses data-qa="message-text" rather than .c-message__body', () => {
    document.body.innerHTML = `
      <div data-qa="threads_flexpane">
        <div class="c-message_kit__message">
          <button data-qa="message_sender_name">Tasnimul Moshiur</button>
          <div class="c-message_kit__blocks">
            <div data-qa="message-text">My password reset has expired.</div>
          </div>
        </div>
        <div class="c-message_kit__message">
          <button data-qa="message_sender_name">Pratik Thakker</button>
          <div class="c-message_kit__blocks">
            <div data-qa="message-text">Fixed in production.</div>
          </div>
        </div>
      </div>`;
    const out = attributeSlackThread('Pratik Thakker');
    expect(out).not.toBeNull();
    expect(out).toContain('My password reset has expired.');
    expect(out).toContain('Tasnimul Moshiur');
  });

  it('still reads the older .c-message__body markup', () => {
    document.body.innerHTML = `
      <div data-qa="threads_flexpane">
        <div class="c-message_kit__message">
          <button data-qa="message_sender_name">Grace Robinson</button>
          <div class="c-message__body">Legacy markup still works.</div>
        </div>
      </div>`;
    expect(attributeSlackThread(null)).toContain('Legacy markup still works.');
  });

  it('does not double-count when a message matches more than one selector', () => {
    document.body.innerHTML = `
      <div data-qa="threads_flexpane">
        <div class="c-message_kit__message">
          <button data-qa="message_sender_name">Grace Robinson</button>
          <div class="c-message__body" data-qa="message-text">Only once please.</div>
        </div>
      </div>`;
    const out = attributeSlackThread(null) || '';
    expect((out.match(/Only once please\./g) || []).length).toBe(1);
  });
});
