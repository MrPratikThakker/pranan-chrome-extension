/**
 * The relationship card opens only from the contact chip in the Pranan bar.
 * It used to open by itself over the message on every Gmail and Slack compose
 * (Pratik, 16 Oct 2026).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { stripComments } from './helpers/strip-comments';
import {
  createContactChip,
  dismissRelationshipPopup,
  isPopupActive,
  isPopupAnchoredTo,
  showRelationshipPopup,
} from '../src/content/shared/relationship-popup';
import type { RelationshipPopupData } from '../src/content/shared/relationship-popup';

const gatha: RelationshipPopupData = {
  contactName: 'Gatha Dubey',
  contactEmail: 'gatha@example.com',
  tier: 'team',
  health: null,
  healthScore: null,
  organization: null,
  roleTitle: null,
  lastInteraction: null,
  recentTopics: ['eSIM QR code installation'],
  formality: 'Unknown',
  avgLength: 'Unknown',
};

function chipButton(el: HTMLElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector('button')!;
}

function mountChip() {
  const chip = createContactChip((anchor, data, options) => showRelationshipPopup(anchor, data, undefined, undefined, options));
  document.body.appendChild(chip.el);
  return chip;
}

afterEach(() => {
  dismissRelationshipPopup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('contact chip', () => {
  it('stays hidden and opens nothing until a contact is known', () => {
    const chip = mountChip();
    expect(chip.el.style.display).toBe('none');
    chipButton(chip.el).click();
    expect(isPopupActive()).toBe(false);
  });

  it('shows first name and tier, and opens the card only on click', () => {
    const chip = mountChip();
    chip.setContact(gatha);
    expect(chip.el.style.display).toBe('inline-flex');
    expect(chip.el.shadowRoot!.textContent).toContain('Gatha');
    expect(chip.el.shadowRoot!.textContent).toContain('Team');
    expect(isPopupActive()).toBe(false);

    chipButton(chip.el).click();
    expect(isPopupAnchoredTo(chip.el)).toBe(true);
    expect(chipButton(chip.el).getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a second click, on Escape, and on a click elsewhere', async () => {
    vi.useFakeTimers();
    const chip = mountChip();
    chip.setContact(gatha);

    chipButton(chip.el).click();
    chipButton(chip.el).click();
    expect(isPopupActive()).toBe(false);
    expect(chipButton(chip.el).getAttribute('aria-expanded')).toBe('false');

    chipButton(chip.el).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isPopupActive()).toBe(false);

    chipButton(chip.el).click();
    await vi.advanceTimersByTimeAsync(0);
    document.body.click();
    expect(isPopupActive()).toBe(false);
  });

  it('does not let a closed card\'s click listener close the next one', async () => {
    vi.useFakeTimers();
    const chip = mountChip();
    chip.setContact(gatha);
    chipButton(chip.el).click();
    await vi.advanceTimersByTimeAsync(0);
    // Close with the card's own close button, then reopen from the chip.
    const card = document.querySelector('[data-pranan-popup]')!;
    card.shadowRoot!.querySelector<HTMLButtonElement>('.close-btn')!.click();
    expect(isPopupActive()).toBe(false);
    chipButton(chip.el).click();
    expect(isPopupActive()).toBe(true);
  });

  it('closes its card when the recipient changes', () => {
    const chip = mountChip();
    chip.setContact(gatha);
    chipButton(chip.el).click();
    chip.setContact({ ...gatha, contactName: 'Someone Else', contactEmail: 'else@example.com' });
    expect(isPopupActive()).toBe(false);
    expect(chip.el.shadowRoot!.textContent).toContain('Someone');
  });
});

describe('Slack content script', () => {
  const slack = stripComments(readFileSync('src/content/slack/index.ts', 'utf8'));

  it('never opens the relationship card by itself; only the bar chip opens it', () => {
    expect(slack).not.toContain('showComposeRelationshipPopup');
    expect(slack).not.toMatch(/setTimeout\([^)]*Popup/);
    const bar = slack.slice(slack.indexOf('function injectSlackPromptBar'), slack.indexOf('let pendingSlackDraft'));
    expect(bar).toContain('createContactChip((anchor, data, options) => renderPopup(data, anchor, options))');
  });
});

describe('LinkedIn content script', () => {
  const linkedin = stripComments(readFileSync('src/content/linkedin/index.ts', 'utf8'));

  it('never opens the relationship card by itself; only the message bar chip opens it', () => {
    expect(linkedin).not.toContain('showComposeRelationshipPopup');
    expect(linkedin).not.toMatch(/setTimeout\([^)]*Popup/);
    const bar = linkedin.slice(linkedin.indexOf('function injectMessagingPromptBar'), linkedin.indexOf('function injectCommentPromptBars'));
    expect(bar).toContain('createContactChip((anchor, data, options) => renderPopup(data, anchor, options))');
    // The bar outlives a switch of conversation, so the chip is refreshed on recipient change.
    const detect = linkedin.slice(linkedin.indexOf('function detectActiveCompose'));
    expect(detect).toContain('setTimeout(refreshMessagingChip, 600)');
  });
});
