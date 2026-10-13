/**
 * Gmail's Send button must be found whatever language Gmail is displayed in.
 *
 * IMPORTANT: every fixture in this file is CONSTRUCTED. None was captured from
 * a live Gmail. They are built from the structure this codebase already
 * relies on and has measured (the .btC toolbar row, the .dC group that wraps
 * Send and its options arrow, the .gU cells, the .T-I.J-J5-Ji button classes;
 * see src/content/gmail/index.ts), with the visible text swapped per language.
 * The translated labels are illustrative. These tests prove the finder does
 * not depend on text; they do not prove what a non-English Gmail renders.
 * That needs a manual check with Gmail set to another language.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/observability', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureError: vi.fn(),
  bootstrapSentry: vi.fn(),
  setUser: vi.fn(),
}));

import { findGmailSendButton, findOne, SELECTORS } from '@/content/selectors';
import { addBreadcrumb } from '@/lib/observability';

interface Labels {
  send: string;
  moreOptions: string;
  formatting: string;
  attach: string;
  discard: string;
}

const ENGLISH: Labels = {
  send: 'Send', moreOptions: 'More send options', formatting: 'Formatting options',
  attach: 'Attach files', discard: 'Discard draft',
};
const SPANISH: Labels = {
  send: 'Enviar', moreOptions: 'Más opciones de envío', formatting: 'Opciones de formato',
  attach: 'Adjuntar archivos', discard: 'Descartar borrador',
};
const JAPANESE: Labels = {
  send: '送信', moreOptions: 'その他のオプション', formatting: '書式設定オプション',
  attach: 'ファイルを添付', discard: '下書きを破棄',
};
const ARABIC: Labels = {
  send: 'إرسال', moreOptions: 'خيارات إضافية', formatting: 'خيارات التنسيق',
  attach: 'إرفاق ملفات', discard: 'تجاهل المسودة',
};

/** One compose window with Gmail's toolbar row, labelled in the given language. */
function composeFixture(labels: Labels, shortcut = 'Ctrl-Enter'): string {
  return `
    <div class="M9" role="dialog">
      <div class="Am aiL"><div contenteditable="true" role="textbox" g_editable="true"></div></div>
      <div class="aDh">
        <table><tbody><tr class="btC">
          <td class="gU Up">
            <div class="dC">
              <div class="T-I J-J5-Ji aoO v7 T-I-atl L3" role="button" tabindex="1" data-test="send"
                   data-tooltip="${labels.send} (${shortcut})" aria-label="${labels.send} (${shortcut})">${labels.send}</div>
              <div class="T-I J-J5-Ji hG T-I-atl L3" role="button" tabindex="1" aria-haspopup="true" data-test="more"
                   data-tooltip="${labels.moreOptions}" aria-label="${labels.moreOptions}"></div>
            </div>
          </td>
          <td class="gU">
            <div class="J-Z-I J-J5-Ji" role="button" data-tooltip="${labels.formatting}" aria-label="${labels.formatting}"></div>
            <div class="wG J-Z-I" role="button" data-tooltip="${labels.attach}" aria-label="${labels.attach}"></div>
          </td>
          <td class="gU">
            <div class="oh J-Z-I J-J5-Ji T-I-ax7" role="button" data-tooltip="${labels.discard}" aria-label="${labels.discard}"></div>
          </td>
        </tr></tbody></table>
      </div>
    </div>`;
}

describe('findGmailSendButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('finds Send by structure in the English fixture, without using the fallback', () => {
    document.body.innerHTML = composeFixture(ENGLISH);
    const el = findGmailSendButton(document.querySelector('.M9')!);
    expect(el?.getAttribute('data-test')).toBe('send');
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it.each([
    ['Spanish', SPANISH, 'Ctrl-Intro'],
    ['Japanese', JAPANESE, 'Ctrl-Enter'],
    ['Arabic', ARABIC, 'Ctrl-Enter'],
  ])('finds Send in the constructed %s fixture, where no English text exists', (_name, labels, shortcut) => {
    document.body.innerHTML = composeFixture(labels, shortcut);
    const compose = document.querySelector('.M9')!;

    // The bug: the English-text chain on its own finds nothing here.
    expect(findOne('test.englishOnly', SELECTORS.gmail.sendButton, compose)).toBeNull();

    const el = findGmailSendButton(compose);
    expect(el?.getAttribute('data-test')).toBe('send');
    expect(el?.textContent).toBe(labels.send);
  });

  it('never returns the send-options arrow', () => {
    document.body.innerHTML = composeFixture(SPANISH);
    document.querySelector('[data-test="send"]')!.remove();
    expect(findGmailSendButton(document.querySelector('.M9')!)).toBeNull();
  });

  it('never returns another toolbar button (formatting, attach, discard)', () => {
    document.body.innerHTML = composeFixture(JAPANESE);
    document.querySelector('.dC')!.remove();
    expect(findGmailSendButton(document.querySelector('.M9')!)).toBeNull();
  });

  it('returns nothing rather than guess when two send-style buttons share a group', () => {
    document.body.innerHTML = composeFixture(SPANISH);
    const send = document.querySelector('[data-test="send"]')!;
    const twin = send.cloneNode(true) as HTMLElement;
    twin.setAttribute('data-test', 'twin');
    send.after(twin);
    expect(findGmailSendButton(document.querySelector('.M9')!)).toBeNull();
  });

  it('returns nothing rather than guess when the scope holds two composes', () => {
    document.body.innerHTML = composeFixture(SPANISH) + composeFixture(SPANISH);
    expect(findGmailSendButton(document)).toBeNull();
    // Scoped to one compose, each is still found.
    for (const compose of document.querySelectorAll('.M9')) {
      expect(findGmailSendButton(compose)?.getAttribute('data-test')).toBe('send');
    }
  });

  it('does not match a Send-like button outside a compose toolbar row', () => {
    document.body.innerHTML = '<div class="dC"><div role="button">Enviar</div></div>';
    expect(findGmailSendButton(document)).toBeNull();
  });

  it('keeps the English text match as a fallback when the structure is absent', () => {
    // The shape of the local QA fixture (qa/gmail.html): no .btC row, no .dC group.
    document.body.innerHTML = '<div class="ip iq"><div class="aDh"><div role="button" aria-label="Send" data-tooltip="Send" data-test="send">Send</div></div></div>';
    const el = findGmailSendButton(document.querySelector('.ip.iq')!);
    expect(el?.getAttribute('data-test')).toBe('send');
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.stringContaining('selector_fallback_used: gmail.sendButton'),
      expect.objectContaining({ fallback: 'english_text' }),
    );
  });

  it('falls back to English text when the structure is ambiguous, as before', () => {
    document.body.innerHTML = composeFixture(ENGLISH) + composeFixture(ENGLISH);
    expect(findGmailSendButton(document)?.getAttribute('data-test')).toBe('send');
  });

  it('does not rely on German matching the English chain by accident', () => {
    // "Senden" happens to contain "Send", so the old English chain matched a
    // German Gmail by luck. The structural match must not need that luck.
    const german: Labels = { ...SPANISH, send: 'Senden' };
    document.body.innerHTML = composeFixture(german, 'Strg-Eingabetaste');
    expect(findGmailSendButton(document.querySelector('.M9')!)?.getAttribute('data-test')).toBe('send');
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('returns null when there is no compose at all', () => {
    document.body.innerHTML = '<div>inbox</div>';
    expect(findGmailSendButton(document)).toBeNull();
  });

  it('keeps the structural selector free of any language-specific text', () => {
    for (const selector of SELECTORS.gmail.sendButtonStructural) {
      expect(selector).not.toMatch(/send|tooltip|aria-label/i);
    }
  });
});
