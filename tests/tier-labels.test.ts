/**
 * Regression test for tier-label coverage.
 *
 * Bug class: server returns a tier (e.g. 'partner', 'inner_circle')
 * that isn't a key in the UI's TIER_LABELS map. getTierStyle falls
 * through to the 'unknown' fallback, rendering the contact as
 * 'New Contact' even though they're a known partner / inner-circle
 * contact.
 *
 * Reproduced 2026-05-08 — Pratik flagged Sam Hirbod (HubSpot) showing
 * as 'New Contact' in the side panel. /api/companion/context returned
 * tier='partner' correctly, but the UI didn't have a 'partner' key.
 *
 * This test asserts every server-known tier has a non-fallback UI entry.
 */
import { describe, it, expect } from 'vitest';
import { getTierStyle, getTierLabel, TIER_LABELS, TIER_CSS_COLORS } from '../src/lib/utils';

describe('tier label coverage', () => {
  // Every tier the SERVER may return must be a known key in the UI map.
  // Source: src/lib/companion-auth.ts getUserTier + /api/companion/context
  // tier resolution + relationship classifier output.
  const SERVER_TIERS = [
    'team',          // CC override + getUserTier
    'inner_circle',  // founders, family, closest collaborators
    'client',        // paying customer
    'prospect',      // sales pipeline
    'partner',       // hardcoded partner-domain fallback (HubSpot, Salesforce, etc.)
    'vendor',        // services we use
    'network',       // light-touch professional contacts
    'casual',        // social
    'unknown',       // genuinely no signal
  ];

  it.each(SERVER_TIERS)("has a non-fallback UI entry for tier '%s'", (tier) => {
    expect(TIER_LABELS).toHaveProperty(tier);
    const style = getTierStyle(tier);
    if (tier !== 'unknown') {
      // Anything not 'unknown' must NOT have the fallback label
      expect(style.label).not.toBe('New Contact');
    }
  });

  it("'partner' renders as 'Partner', not 'New Contact'", () => {
    expect(getTierLabel('partner')).toBe('Partner');
    expect(getTierStyle('partner').label).toBe('Partner');
  });

  it("'inner_circle' renders as 'Inner Circle', not 'New Contact'", () => {
    expect(getTierLabel('inner_circle')).toBe('Inner Circle');
    expect(getTierStyle('inner_circle').label).toBe('Inner Circle');
  });

  it("'unknown' is the only tier that should render as 'New Contact'", () => {
    expect(getTierStyle('unknown').label).toBe('New Contact');
  });

  it("genuinely unknown / made-up tier falls through to 'New Contact'", () => {
    expect(getTierStyle('something_made_up').label).toBe('New Contact');
  });

  it('TIER_CSS_COLORS (content-script inline map) has the same coverage as TIER_LABELS', () => {
    // Bug class: TIER_LABELS gets a new tier added, but TIER_CSS_COLORS
    // (used inside content scripts that render plain HTML, no Tailwind)
    // doesn't. Result: tiers render correctly in popup/sidepanel but show
    // 'New Contact' inside Gmail/Slack relationship popups. This test
    // catches that divergence on every CI run.
    const labelKeys = new Set(Object.keys(TIER_LABELS));
    const cssKeys = new Set(Object.keys(TIER_CSS_COLORS));
    for (const k of labelKeys) {
      expect(cssKeys.has(k)).toBe(true);
    }
    for (const k of cssKeys) {
      expect(labelKeys.has(k)).toBe(true);
    }
  });

  it('every tier label is non-empty and human-readable', () => {
    // Defends against accidentally setting label to '' or undefined during
    // a refactor — would render an empty pill in the UI, looks broken.
    for (const [tier, style] of Object.entries(TIER_LABELS)) {
      expect(style.label, `tier '${tier}' must have a non-empty label`).toBeTruthy();
      expect(style.label.length, `tier '${tier}' label must be at least 2 chars`).toBeGreaterThanOrEqual(2);
    }
  });
});
