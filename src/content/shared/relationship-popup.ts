/**
 * Relationship Popup (Inline Contact Card)
 *
 * Floating card showing relationship context, tier, health, and quick actions.
 *
 * The card opens only when the user asks for it, from the small contact chip
 * in the Pranan bar (createContactChip below). It used to open by itself 600ms
 * after every Gmail and Slack compose and again on every recipient change,
 * anchored under the To field, so it sat on top of the message being written
 * and had to be closed every time (Pratik, 16 Oct 2026).
 *
 * Injected via Shadow DOM for style isolation.
 */

import { escapeHtml, TIER_CSS_COLORS, HEALTH_CSS_COLORS, formatLastInteraction } from '@/lib/utils';

export interface RelationshipPopupData {
  contactName: string;
  contactEmail: string | null;
  tier: string;
  health: string | null;
  healthScore: number | null;
  organization: string | null;
  roleTitle: string | null;
  lastInteraction: string | null;
  recentTopics: string[];
  formality: string;
  avgLength: string;
}

export interface RelationshipPopupOptions {
  /** Open above the anchor when there is room. Used for anchors near the bottom of a compose. */
  placement?: 'above' | 'below';
  /** Called once when the card closes, however it closes. */
  onDismiss?: () => void;
}

const POPUP_ATTR = 'data-pranan-popup';
let activePopup: HTMLElement | null = null;
let activeAnchor: Element | null = null;
let activeCleanup: (() => void) | null = null;

/**
 * Show a relationship popup anchored to a specific element
 */
export function showRelationshipPopup(
  anchor: Element,
  data: RelationshipPopupData,
  onDraftClick?: () => void,
  onViewFullClick?: () => void,
  options: RelationshipPopupOptions = {}
): HTMLElement {
  // Remove any existing popup first
  dismissRelationshipPopup();

  const host = document.createElement('div');
  host.setAttribute(POPUP_ATTR, 'true');
  // Fixed, in viewport coordinates. Gmail and Slack scroll inner containers,
  // not the window, so a page-absolute card drifted away from its anchor.
  host.style.position = 'fixed';
  host.style.zIndex = '10001';

  const shadow = host.attachShadow({ mode: 'open' });

  const tier = TIER_CSS_COLORS[data.tier] || TIER_CSS_COLORS.unknown;
  const health = data.health ? (HEALTH_CSS_COLORS[data.health] || null) : null;

  shadow.innerHTML = `
    <style>
      :host {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      }
      .popup {
        width: 280px;
        background: #18181b;
        border: 1px solid rgba(250,250,250,0.08);
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.5);
        animation: fadeSlideIn 150ms ease-out;
        color: #fafafa;
      }
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 10px;
      }
      .avatar {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: rgba(167,139,250,0.15);
        border: 1px solid rgba(167,139,250,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: #a78bfa;
        font-weight: 600;
        flex-shrink: 0;
      }
      .info {
        min-width: 0;
        flex: 1;
      }
      .name {
        font-size: 13px;
        font-weight: 600;
        color: #fafafa;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .subtitle {
        font-size: 11px;
        color: rgba(250,250,250,0.4);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badges {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
      }
      .tier-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.3px;
      }
      .health-badge {
        font-size: 10px;
        font-weight: 500;
      }
      .score {
        margin-left: auto;
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        color: rgba(250,250,250,0.35);
      }
      .meta-row {
        display: flex;
        gap: 12px;
        margin-bottom: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(250,250,250,0.06);
      }
      .meta-item {
        font-size: 10px;
      }
      .meta-label {
        color: rgba(250,250,250,0.35);
        display: block;
        margin-bottom: 1px;
      }
      .meta-value {
        color: rgba(250,250,250,0.7);
        font-weight: 500;
      }
      .topics {
        margin-bottom: 10px;
      }
      .topics-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        color: #a78bfa;
        margin-bottom: 4px;
      }
      .topics-label::before {
        content: '// ';
      }
      .topic-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .topic-tag {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(250,250,250,0.04);
        border: 1px solid rgba(250,250,250,0.07);
        color: rgba(250,250,250,0.5);
      }
      .actions {
        display: flex;
        gap: 6px;
      }
      .action-btn {
        flex: 1;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 600;
        font-family: inherit;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        transition: all 0.1s ease;
        text-align: center;
      }
      .action-btn.primary {
        background: linear-gradient(135deg, #6d28d9, #a78bfa);
        color: #fafafa;
      }
      .action-btn.primary:hover {
        box-shadow: 0 2px 8px rgba(167,139,250,0.3);
      }
      .action-btn.secondary {
        background: rgba(250,250,250,0.04);
        color: rgba(250,250,250,0.6);
        border: 1px solid rgba(250,250,250,0.08);
      }
      .action-btn.secondary:hover {
        background: rgba(250,250,250,0.08);
        color: #fafafa;
      }
      .close-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: rgba(250,250,250,0.25);
        cursor: pointer;
        border-radius: 4px;
        font-size: 14px;
        line-height: 1;
      }
      .close-btn:hover {
        color: rgba(250,250,250,0.6);
        background: rgba(250,250,250,0.06);
      }
    </style>
    <div class="popup" role="dialog" aria-label="${escapeHtml(`Relationship context for ${data.contactName}`)}" style="position: relative;">
      <button class="close-btn" title="Close" aria-label="Close">&times;</button>
      <div class="header">
        <div class="avatar">${escapeHtml(data.contactName.charAt(0).toUpperCase())}</div>
        <div class="info">
          <div class="name">${escapeHtml(data.contactName)}</div>
          <div class="subtitle">${data.roleTitle ? `${escapeHtml(data.roleTitle)}${data.organization ? ' at ' + escapeHtml(data.organization) : ''}` : escapeHtml(data.contactEmail || '')}</div>
        </div>
      </div>

      <div class="badges">
        <span class="tier-badge" style="background: ${tier.bg}; color: ${tier.text};">${escapeHtml(tier.label)}</span>
        ${health ? `<span class="health-badge" style="color: ${health.color};">${escapeHtml(health.label)}</span>` : ''}
        ${data.healthScore && data.healthScore > 0 ? `<span class="score">${Number(data.healthScore)}/100</span>` : ''}
      </div>

      <div class="meta-row">
        <div class="meta-item">
          <span class="meta-label">Last contact</span>
          <span class="meta-value">${escapeHtml(formatLastInteraction(data.lastInteraction))}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Formality</span>
          <span class="meta-value">${escapeHtml(data.formality)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Length</span>
          <span class="meta-value">${escapeHtml(data.avgLength)}</span>
        </div>
      </div>

      ${data.recentTopics.length > 0 ? `
        <div class="topics">
          <div class="topics-label">Recent Topics</div>
          <div class="topic-tags">
            ${data.recentTopics.slice(0, 4).map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      <div class="actions">
        ${onDraftClick ? `<button class="action-btn primary" id="draft-btn">Draft Reply</button>` : ''}
        ${onViewFullClick ? `<button class="action-btn secondary" id="view-btn">Full Context</button>` : ''}
      </div>
    </div>
  `;

  // Wire events
  const closeBtn = shadow.querySelector('.close-btn');
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissRelationshipPopup();
  });

  if (onDraftClick) {
    shadow.getElementById('draft-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      onDraftClick();
    });
  }

  if (onViewFullClick) {
    shadow.getElementById('view-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      onViewFullClick();
    });
  }

  document.body.appendChild(host);

  const placement = options.placement ?? 'below';
  const place = () => {
    if (!anchor.isConnected) {
      dismissRelationshipPopup();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const card = host.getBoundingClientRect();
    const roomAbove = rect.top - 14;
    const roomBelow = window.innerHeight - rect.bottom - 14;
    const above = placement === 'above'
      ? roomAbove >= card.height || roomAbove > roomBelow
      : roomBelow < card.height && roomAbove > roomBelow;
    const top = above ? rect.top - card.height - 6 : rect.bottom + 6;
    const maxLeft = Math.max(8, window.innerWidth - card.width - 8);
    host.style.top = `${Math.max(8, top)}px`;
    host.style.left = `${Math.min(Math.max(8, rect.left), maxLeft)}px`;
  };
  place();

  activePopup = host;
  activeAnchor = anchor;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismissRelationshipPopup();
    }
  };
  const outsideClick = (e: MouseEvent) => {
    if (!host.contains(e.target as Node)) dismissRelationshipPopup();
  };
  // Keep the card on its anchor while Gmail or Slack scrolls an inner pane.
  const onMove = () => place();
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
  // Deferred so the click that opened the card does not also close it.
  const armTimer = setTimeout(() => document.addEventListener('click', outsideClick), 0);

  activeCleanup = () => {
    clearTimeout(armTimer);
    document.removeEventListener('click', outsideClick);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onMove, true);
    window.removeEventListener('resize', onMove);
    options.onDismiss?.();
  };

  return host;
}

/**
 * Dismiss the active relationship popup
 */
export function dismissRelationshipPopup() {
  // Run the previous card's cleanup first. Its outside-click listener used to
  // outlive the card, so the next click anywhere closed whichever card was
  // open by then, including one the user had just opened.
  const cleanup = activeCleanup;
  activeCleanup = null;
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  activeAnchor = null;
  // Also remove any orphans
  document.querySelectorAll(`[${POPUP_ATTR}]`).forEach(el => el.remove());
  cleanup?.();
}

/**
 * Check if a popup is currently active
 */
export function isPopupActive(): boolean {
  return activePopup !== null;
}

/** True when the open card belongs to this anchor. */
export function isPopupAnchoredTo(anchor: Element): boolean {
  return activePopup !== null && activeAnchor === anchor;
}

// ---------------------------------------------------------------------------
// Contact chip: the one way the card opens
// ---------------------------------------------------------------------------

export interface ContactChip {
  /** The element to place in the Pranan bar. Hidden until a contact is set. */
  el: HTMLElement;
  /** Show this contact, or hide the chip with null. Closes its card if the contact changed. */
  setContact(data: RelationshipPopupData | null): void;
  setTheme(theme: 'light' | 'dark'): void;
}

export const CONTACT_CHIP_ATTR = 'data-pranan-contact-chip';

/**
 * A small "initial, first name, tier" chip for the Pranan bar. Clicking it
 * opens the relationship card above it; clicking again, Escape, or a click
 * anywhere else closes it. Nothing opens unless the user clicks.
 */
export function createContactChip(
  open: (anchor: HTMLElement, data: RelationshipPopupData, options: RelationshipPopupOptions) => void
): ContactChip {
  const host = document.createElement('span');
  host.setAttribute(CONTACT_CHIP_ATTR, 'true');
  host.style.cssText = 'display:none;flex:none;align-items:center;min-width:0;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 170px;
        height: 24px;
        padding: 0 8px 0 3px;
        border: 1px solid #e9e5ff;
        border-radius: 12px;
        background: #f5f3ff;
        color: #4c1d95;
        font: 600 12px/1 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        cursor: pointer;
        white-space: nowrap;
      }
      button:hover, button[aria-expanded="true"] { background: #ede9fe; border-color: #c4b5fd; }
      button:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
      .avatar {
        width: 18px;
        height: 18px;
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: #ddd6fe;
        color: #5b21b6;
        font-size: 10px;
      }
      .name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .tier { flex: none; color: #6b7280; font-weight: 500; }
      :host([data-theme="dark"]) button { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.28); color: #ddd6fe; }
      :host([data-theme="dark"]) button:hover,
      :host([data-theme="dark"]) button[aria-expanded="true"] { background: rgba(167,139,250,0.2); border-color: #a78bfa; }
      :host([data-theme="dark"]) .avatar { background: rgba(167,139,250,0.25); color: #ede9fe; }
      :host([data-theme="dark"]) .tier { color: #cbd5e1; }
    </style>
    <button type="button" aria-haspopup="dialog" aria-expanded="false">
      <span class="avatar"></span><span class="name"></span><span class="tier"></span>
    </button>
  `;
  const button = shadow.querySelector('button')!;
  const avatar = shadow.querySelector<HTMLElement>('.avatar')!;
  const name = shadow.querySelector<HTMLElement>('.name')!;
  const tierEl = shadow.querySelector<HTMLElement>('.tier')!;
  let contact: RelationshipPopupData | null = null;

  const setExpanded = (expanded: boolean) => button.setAttribute('aria-expanded', String(expanded));

  button.addEventListener('mousedown', (e) => {
    // Keep focus where the user was typing.
    e.preventDefault();
  });
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!contact) return;
    if (isPopupAnchoredTo(host)) {
      dismissRelationshipPopup();
      return;
    }
    open(host, contact, { placement: 'above', onDismiss: () => setExpanded(false) });
    if (isPopupAnchoredTo(host)) setExpanded(true);
  });

  return {
    el: host,
    setContact(data) {
      const changed = (data?.contactEmail ?? data?.contactName ?? null) !== (contact?.contactEmail ?? contact?.contactName ?? null);
      if (changed && isPopupAnchoredTo(host)) dismissRelationshipPopup();
      contact = data && data.contactName ? data : null;
      if (!contact) {
        host.style.display = 'none';
        return;
      }
      const tier = TIER_CSS_COLORS[contact.tier] || TIER_CSS_COLORS.unknown;
      const firstName = contact.contactName.trim().split(/\s+/)[0] || contact.contactName;
      avatar.textContent = contact.contactName.trim().charAt(0).toUpperCase();
      name.textContent = firstName;
      tierEl.textContent = tier.label;
      button.title = `${contact.contactName}: relationship context`;
      button.setAttribute('aria-label', `Show relationship context for ${contact.contactName}`);
      host.style.display = 'inline-flex';
    },
    setTheme(theme) {
      host.setAttribute('data-theme', theme);
    },
  };
}
