/**
 * Relationship Popup (Inline Contact Card)
 *
 * Floating card that appears near compose windows showing relationship
 * context, tier, health, and quick actions. Apollo-style enrichment popup.
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

const POPUP_ATTR = 'data-pranan-popup';
let activePopup: HTMLElement | null = null;

/**
 * Show a relationship popup anchored to a specific element
 */
export function showRelationshipPopup(
  anchor: Element,
  data: RelationshipPopupData,
  onDraftClick?: () => void,
  onViewFullClick?: () => void
): HTMLElement {
  // Remove any existing popup first
  dismissRelationshipPopup();

  const host = document.createElement('div');
  host.setAttribute(POPUP_ATTR, 'true');
  host.style.position = 'absolute';
  host.style.zIndex = '10001';

  const shadow = host.attachShadow({ mode: 'open' });

  const tier = TIER_CSS_COLORS[data.tier] || TIER_CSS_COLORS.unknown;
  const health = data.health ? (HEALTH_CSS_COLORS[data.health] || null) : null;

  shadow.innerHTML = `
    <style>
      :host {
        font-family: 'Inter', -apple-system, system-ui, sans-serif;
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
    <div class="popup" style="position: relative;">
      <button class="close-btn" title="Dismiss">&times;</button>
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

  // Position near anchor
  document.body.appendChild(host);
  const rect = anchor.getBoundingClientRect();
  host.style.top = `${rect.bottom + window.scrollY + 6}px`;
  host.style.left = `${Math.max(8, rect.left + window.scrollX - 80)}px`;

  // Clamp to viewport
  requestAnimationFrame(() => {
    const popupRect = host.getBoundingClientRect();
    if (popupRect.right > window.innerWidth - 8) {
      host.style.left = `${window.innerWidth - popupRect.width - 8}px`;
    }
    if (popupRect.bottom > window.innerHeight - 8) {
      host.style.top = `${rect.top + window.scrollY - popupRect.height - 6}px`;
    }
  });

  activePopup = host;

  // Auto-dismiss on outside click (delayed to avoid immediate dismissal)
  setTimeout(() => {
    const outsideClick = (e: MouseEvent) => {
      if (!host.contains(e.target as Node)) {
        dismissRelationshipPopup();
        document.removeEventListener('click', outsideClick);
      }
    };
    document.addEventListener('click', outsideClick);
  }, 100);

  return host;
}

/**
 * Dismiss the active relationship popup
 */
export function dismissRelationshipPopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  // Also remove any orphans
  document.querySelectorAll(`[${POPUP_ATTR}]`).forEach(el => el.remove());
}

/**
 * Check if a popup is currently active
 */
export function isPopupActive(): boolean {
  return activePopup !== null;
}
