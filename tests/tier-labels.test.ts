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
import { getTierStyle, getTierLabel, TIER_LABELS } from '../src/lib/utils';

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
});
