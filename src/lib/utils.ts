/**
 * Shared utilities for Pranan Companion
 *
 * Contains HTML sanitization, tier/health label maps,
 * and common formatting helpers used across content scripts
 * and React components.
 */

// ---------------------------------------------------------------------------
// HTML Sanitization
// ---------------------------------------------------------------------------

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

/**
 * Escape a string for safe insertion into innerHTML templates.
 * Returns empty string for nullish values.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch] || ch);
}

// ---------------------------------------------------------------------------
// Tier Labels & Colors
// ---------------------------------------------------------------------------

export interface TierStyle {
  label: string;
  bg: string;
  text: string;
  border: string;
}

/**
 * Canonical tier label map. Use this everywhere instead of local copies.
 * Keys match the values returned by the backend relationship engine.
 */
export const TIER_LABELS: Record<string, TierStyle> = {
  inner_circle: { label: 'Inner Circle', bg: 'bg-brand-glow',        text: 'text-brand-accent',   border: 'border-brand-accent/30' },
  vip:          { label: 'VIP',          bg: 'bg-brand-glow',        text: 'text-brand-accent',   border: 'border-brand-accent/30' },
  team:         { label: 'Team',         bg: 'bg-blue-500/10',       text: 'text-blue-400',       border: 'border-blue-400/30' },
  client:       { label: 'Client',       bg: 'bg-emerald-500/10',    text: 'text-emerald-400',    border: 'border-emerald-400/30' },
  prospect:     { label: 'Prospect',     bg: 'bg-amber-500/10',      text: 'text-amber-400',      border: 'border-amber-400/30' },
  active:       { label: 'Active',       bg: 'bg-emerald-500/10',    text: 'text-emerald-400',    border: 'border-emerald-400/30' },
  vendor:       { label: 'Vendor',       bg: 'bg-slate-500/10',      text: 'text-slate-400',      border: 'border-slate-400/30' },
  network:      { label: 'Network',      bg: 'bg-indigo-500/10',     text: 'text-indigo-400',     border: 'border-indigo-400/30' },
  casual:       { label: 'Casual',       bg: 'bg-slate-500/10',      text: 'text-slate-400',      border: 'border-slate-400/30' },
  new:          { label: 'New',          bg: 'bg-brand-accent/10',   text: 'text-brand-accent',   border: 'border-brand-accent/30' },
  unknown:      { label: 'New Contact',  bg: 'bg-brand-surface-2',   text: 'text-brand-text-3',   border: 'border-brand-border' },
};

/**
 * Get a display-friendly tier label. Falls back to title-casing the key.
 */
export function getTierLabel(tier: string): string {
  return TIER_LABELS[tier]?.label ?? tier.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get full tier style object with safe fallback.
 */
export function getTierStyle(tier: string): TierStyle {
  return TIER_LABELS[tier] ?? TIER_LABELS.unknown;
}

// ---------------------------------------------------------------------------
// Health Indicators
// ---------------------------------------------------------------------------

export interface HealthStyle {
  label: string;
  color: string;
}

export const HEALTH_LABELS: Record<string, HealthStyle> = {
  warming: { label: 'Warming', color: 'text-brand-green' },
  steady:  { label: 'Steady',  color: 'text-blue-400' },
  cooling: { label: 'Cooling', color: 'text-brand-amber' },
  dormant: { label: 'Dormant', color: 'text-brand-text-3' },
  new:     { label: 'New',     color: 'text-brand-accent' },
};

export function getHealthStyle(health: string | null | undefined): HealthStyle | null {
  if (!health) return null;
  return HEALTH_LABELS[health] ?? null;
}

// ---------------------------------------------------------------------------
// Date Formatting
// ---------------------------------------------------------------------------

/**
 * Format a date string as a human-friendly relative time.
 * Shared between ContactCard.tsx and relationship-popup.ts.
 */
export function formatLastInteraction(dateStr: string | null | undefined): string {
  if (!dateStr) return 'No history';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'No history';
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

// ---------------------------------------------------------------------------
// CSS-safe tier labels for content scripts (plain HTML, no Tailwind)
// ---------------------------------------------------------------------------

export const TIER_CSS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  inner_circle: { bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)', label: 'Inner Circle' },
  vip:          { bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)', label: 'VIP' },
  team:         { bg: 'rgba(59, 130, 246, 0.1)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)', label: 'Team' },
  client:       { bg: 'rgba(16, 185, 129, 0.1)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)', label: 'Client' },
  prospect:     { bg: 'rgba(245, 158, 11, 0.1)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)', label: 'Prospect' },
  active:       { bg: 'rgba(16, 185, 129, 0.1)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)', label: 'Active' },
  vendor:       { bg: 'rgba(100, 116, 139, 0.1)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.3)', label: 'Vendor' },
  network:      { bg: 'rgba(99, 102, 241, 0.1)', text: '#818cf8', border: 'rgba(99, 102, 241, 0.3)', label: 'Network' },
  casual:       { bg: 'rgba(100, 116, 139, 0.1)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.3)', label: 'Casual' },
  new:          { bg: 'rgba(139, 92, 246, 0.1)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)', label: 'New' },
  unknown:      { bg: 'rgba(100, 116, 139, 0.05)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.2)', label: 'New Contact' },
};

export const HEALTH_CSS_COLORS: Record<string, { color: string; label: string }> = {
  warming: { color: '#4ade80', label: 'Warming' },
  steady:  { color: '#60a5fa', label: 'Steady' },
  cooling: { color: '#fbbf24', label: 'Cooling' },
  dormant: { color: '#94a3b8', label: 'Dormant' },
  new:     { color: '#a78bfa', label: 'New' },
};
