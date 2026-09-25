/**
 * Audit EXT-13: long threads kept the OLDEST text and cut the newest message,
 * the one being replied to. Audit EXT-31: a grouped Slack follow-up took the
 * first sender in the whole pane.
 */
import { describe, expect, it } from 'vitest';
import { keepNewestChars } from '../src/lib/thread-context';
import { attributeSlackThread, attributeLinkedInHistory, findSenderFor } from '../src/content/shared/thread-attribution';

describe('keepNewestChars', () => {
  it('leaves short text alone', () => {
    expect(keepNewestChars('short', 100)).toBe('short');
  });
  it('drops the oldest text and starts on a clean line', () => {
    const text = `${'old line '.repeat(50)}\nnewest message`;
    const out = keepNewestChars(text, 40);
    expect(out.endsWith('newest message')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.startsWith('old')).toBe(false);
  });
});

describe('long threads keep the message being replied to', () => {
  it('Slack thread context ends with the newest message', () => {
    const long = 'x'.repeat(900);
    document.body.innerHTML = `
      <div data-qa="threads_flexpane">
        ${[1, 2, 3, 4].map((n) => `<div class="c-message_kit__message"><button data-qa="message_sender_name">Grace</button><div class="c-message__body">old ${n} ${long}</div></div>`).join('')}
        <div class="c-message_kit__message"><button data-qa="message_sender_name">Grace</button><div class="c-message__body">NEWEST: can you confirm Friday?</div></div>
      </div>`;
    const out = attributeSlackThread(null) || '';
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain('NEWEST: can you confirm Friday?');
  });

  it('LinkedIn history ends with the newest message', () => {
    const long = 'y'.repeat(900);
    document.body.innerHTML = `<div class="msg-s-message-list-content">
      ${[1, 2, 3, 4].map((n) => `<div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Adam</span><p class="msg-s-event-listitem__body">old ${n} ${long}</p></div>`).join('')}
      <div class="msg-s-event-listitem"><span class="msg-s-message-group__name">Adam</span><p class="msg-s-event-listitem__body">NEWEST: are you free Tuesday?</p></div>
    </div>`;
    const out = attributeLinkedInHistory(null) || '';
    expect(out).toContain('NEWEST: are you free Tuesday?');
  });
});

describe('Slack sender for grouped messages', () => {
  it('uses the nearest earlier sender in the list, not the first in the pane', () => {
    document.body.innerHTML = `
      <div class="c-virtual_list__scroll_container">
        <div class="c-virtual_list__item"><div class="c-message_kit__message"><button data-qa="message_sender_name">Alice</button><div class="c-message__body" id="a">First</div></div></div>
        <div class="c-virtual_list__item"><div class="c-message_kit__message"><button data-qa="message_sender_name">Bob</button><div class="c-message__body" id="b1">Bob one</div></div></div>
        <div class="c-virtual_list__item"><div class="c-message_kit__message"><div class="c-message__body" id="b2">Bob two, grouped</div></div></div>
      </div>`;
    expect(findSenderFor(document.getElementById('a')!)).toBe('Alice');
    expect(findSenderFor(document.getElementById('b1')!)).toBe('Bob');
    expect(findSenderFor(document.getElementById('b2')!)).toBe('Bob');
  });
});
