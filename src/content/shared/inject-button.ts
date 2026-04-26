/**
 * Shared Inline Button Injection Utility
 *
 * Creates branded Pranan buttons isolated in Shadow DOM so they don't
 * conflict with host page styles. Used by Gmail, Slack, and LinkedIn
 * content scripts to inject "Draft with Pranan" buttons near Send.
 *
 * Pattern inspired by Voila, Loom, and Grammarly Chrome extensions.
 */

import { escapeHtml } from '@/lib/utils';

// WeakMap to store shadow roots for closed-mode Shadow DOM (no longer needed, using open mode)
// Kept as a fallback pattern in case we ever need to go back to closed mode
const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();

export interface InlineButtonConfig {
  /** Unique ID for dedup */
  id: string;
  /** Label shown on the button */
  label: string;
  /** Tooltip */
  title?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Where to insert relative to anchor */
  position?: 'before' | 'after';
  /** Callback when clicked */
  onClick: () => void;
  /** Optional secondary actions (dropdown) */
  secondaryActions?: Array<{ label: string; onClick: () => void }>;
}

const PRANAN_BUTTON_ATTR = 'data-pranan-injected';

/**
 * Inject a Pranan button near a target anchor element.
 * Uses Shadow DOM for style isolation.
 */
export function injectInlineButton(
  anchor: Element,
  config: InlineButtonConfig
): HTMLElement | null {
  // Dedup: don't inject twice
  const existing = anchor.parentElement?.querySelector(`[${PRANAN_BUTTON_ATTR}="${config.id}"]`);
  if (existing) return existing as HTMLElement;

  // Create host element
  const host = document.createElement('div');
  host.setAttribute(PRANAN_BUTTON_ATTR, config.id);
  host.style.display = 'inline-flex';
  host.style.alignItems = 'center';
  host.style.marginLeft = '4px';
  host.style.marginRight = '2px';
  host.style.verticalAlign = 'middle';
  host.style.position = 'relative';
  host.style.zIndex = '999';

  // Shadow DOM for isolation (open mode so setButtonLoading can access it)
  const shadow = host.attachShadow({ mode: 'open' });
  shadowRoots.set(host, shadow);

  const hasDropdown = config.secondaryActions && config.secondaryActions.length > 0;

  shadow.innerHTML = `
    <style>
      :host {
        display: inline-flex;
        align-items: center;
        font-family: -apple-system, system-ui, sans-serif;
      }
      .pranan-btn-wrap {
        display: inline-flex;
        align-items: center;
        position: relative;
      }
      .pranan-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s ease;
        opacity: 0.55;
      }
      .pranan-btn:hover {
        opacity: 1;
        background: rgba(109, 40, 217, 0.08);
      }
      .pranan-btn:active {
        background: rgba(109, 40, 217, 0.14);
      }
      .pranan-btn svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      .pranan-dropdown-trigger {
        display: none;
      }
      .pranan-btn-wrap:hover .pranan-dropdown-trigger {
        display: inline-flex;
      }
      .pranan-dropdown-trigger {
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        margin-left: -2px;
        color: #6d28d9;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.1s ease;
        opacity: 0.6;
      }
      .pranan-dropdown-trigger:hover {
        opacity: 1;
        background: rgba(109, 40, 217, 0.08);
      }
      .pranan-dropdown-trigger svg {
        width: 10px;
        height: 10px;
      }
      .pranan-dropdown {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 160px;
        background: #fff;
        border: 1px solid rgba(0,0,0,0.12);
        border-radius: 8px;
        padding: 4px;
        z-index: 10000;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      }
      .pranan-dropdown.open {
        display: block;
      }
      .pranan-dropdown-item {
        display: block;
        width: 100%;
        padding: 6px 10px;
        font-size: 12px;
        font-family: inherit;
        color: #333;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
        transition: all 0.1s ease;
      }
      .pranan-dropdown-item:hover {
        background: rgba(109, 40, 217, 0.06);
        color: #6d28d9;
      }
      .pranan-loading .pranan-btn {
        opacity: 0.4;
        pointer-events: none;
      }
      .pranan-loading .pranan-btn svg {
        animation: pranan-spin 1s linear infinite;
      }
      @keyframes pranan-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
    <div class="pranan-btn-wrap">
      <button class="pranan-btn" title="${escapeHtml(config.title || config.label)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="#6d28d9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </button>
      ${hasDropdown ? `
        <button class="pranan-dropdown-trigger" title="More options">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="pranan-dropdown">
          ${config.secondaryActions!.map((a, i) =>
            `<button class="pranan-dropdown-item" data-action-idx="${i}">${escapeHtml(a.label)}</button>`
          ).join('')}
        </div>
      ` : ''}
    </div>
  `;

  // Wire click handlers
  const mainBtn = shadow.querySelector('.pranan-btn')!;
  mainBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    config.onClick();
  });

  // Dropdown logic
  if (hasDropdown) {
    const trigger = shadow.querySelector('.pranan-dropdown-trigger')!;
    const dropdown = shadow.querySelector('.pranan-dropdown')!;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close dropdown on outside click
    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
    });

    // Wire dropdown items
    const items = shadow.querySelectorAll('.pranan-dropdown-item');
    items.forEach((item) => {
      const idx = parseInt(item.getAttribute('data-action-idx') || '0', 10);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdown.classList.remove('open');
        config.secondaryActions![idx]?.onClick();
      });
    });
  }

  // Insert into DOM
  if (config.position === 'before') {
    anchor.parentElement?.insertBefore(host, anchor);
  } else {
    anchor.parentElement?.insertBefore(host, anchor.nextSibling);
  }

  return host;
}

/**
 * Set loading state on a Pranan injected button
 */
export function setButtonLoading(host: HTMLElement, loading: boolean) {
  const shadow = host.shadowRoot || shadowRoots.get(host);
  if (!shadow) return;
  const wrap = shadow.querySelector('.pranan-btn-wrap');
  if (wrap) {
    if (loading) {
      wrap.classList.add('pranan-loading');
    } else {
      wrap.classList.remove('pranan-loading');
    }
  }
}

/**
 * Remove all Pranan injected buttons from a container
 */
export function removeInjectedButtons(container: Element) {
  const buttons = container.querySelectorAll(`[${PRANAN_BUTTON_ATTR}]`);
  buttons.forEach(btn => btn.remove());
}

/**
 * Check if a Pranan button already exists near an anchor
 */
export function hasInjectedButton(anchor: Element, id: string): boolean {
  return !!anchor.parentElement?.querySelector(`[${PRANAN_BUTTON_ATTR}="${id}"]`);
}
