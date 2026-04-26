/**
 * Universal Text Field Detector
 *
 * Platform-agnostic detection of text input fields across any web app.
 * Works on HubSpot, Intercom, Zendesk, Notion, Salesforce, etc.
 *
 * Strategy:
 * 1. Detect all contentEditable elements and textareas
 * 2. Score them by likelihood of being a "compose" field
 * 3. Filter out nav, search, and tiny inputs
 * 4. Attach Pranan enhancement buttons to qualifying fields
 */

export interface DetectedField {
  element: HTMLElement;
  type: 'contenteditable' | 'textarea' | 'input';
  score: number;
  context: {
    isEmail: boolean;
    isChat: boolean;
    isComment: boolean;
    isPost: boolean;
    isSearch: boolean;
    platform: string;
  };
}

// Minimum dimensions to qualify as a compose field (not a search box)
const MIN_WIDTH = 200;
const MIN_HEIGHT = 40;

// Words that suggest "compose" context in nearby DOM
const COMPOSE_SIGNALS = [
  'send', 'reply', 'compose', 'message', 'write', 'post', 'comment',
  'respond', 'email', 'subject', 'body', 'draft', 'submit', 'publish',
];

// Words that suggest "search" context (disqualify)
const SEARCH_SIGNALS = [
  'search', 'find', 'filter', 'lookup', 'query',
];

// Known platform patterns
const PLATFORM_PATTERNS: Array<{ match: RegExp; platform: string }> = [
  { match: /hubspot\.com/i, platform: 'hubspot' },
  { match: /intercom\.io|intercomcdn/i, platform: 'intercom' },
  { match: /zendesk\.com/i, platform: 'zendesk' },
  { match: /salesforce\.com|force\.com/i, platform: 'salesforce' },
  { match: /notion\.so/i, platform: 'notion' },
  { match: /asana\.com/i, platform: 'asana' },
  { match: /monday\.com/i, platform: 'monday' },
  { match: /freshdesk\.com/i, platform: 'freshdesk' },
  { match: /front\.com|frontapp\.com/i, platform: 'front' },
  { match: /missive\.io/i, platform: 'missive' },
  { match: /helpscout\.com/i, platform: 'helpscout' },
  { match: /crisp\.chat/i, platform: 'crisp' },
  { match: /drift\.com/i, platform: 'drift' },
  { match: /teams\.microsoft/i, platform: 'teams' },
  { match: /discord\.com/i, platform: 'discord' },
  { match: /telegram\.org/i, platform: 'telegram' },
  { match: /whatsapp\.com/i, platform: 'whatsapp' },
];

function detectPlatform(): string {
  const url = window.location.href;
  for (const p of PLATFORM_PATTERNS) {
    if (p.match.test(url)) return p.platform;
  }
  return 'unknown';
}

function getElementContext(el: HTMLElement): string {
  // Gather text from the element and nearby DOM for signal detection
  const parts: string[] = [];

  // Element's own attributes
  parts.push(el.getAttribute('aria-label') || '');
  parts.push(el.getAttribute('placeholder') || '');
  parts.push(el.getAttribute('data-placeholder') || '');
  parts.push(el.getAttribute('role') || '');
  parts.push(el.getAttribute('name') || '');
  parts.push(el.id || '');
  parts.push(el.className || '');

  // Parent labels and headers (walk up 3 levels)
  let parent: Element | null = el.parentElement;
  for (let i = 0; i < 3 && parent; i++) {
    const label = parent.querySelector('label, h1, h2, h3, h4, [class*="header"], [class*="title"]');
    if (label) parts.push(label.textContent || '');
    parts.push(parent.className || '');
    parent = parent.parentElement;
  }

  // Sibling buttons
  const container = el.closest('form, [role="dialog"], [class*="compose"], [class*="editor"]') || el.parentElement;
  if (container) {
    const buttons = container.querySelectorAll('button, [role="button"], input[type="submit"]');
    buttons.forEach(btn => {
      parts.push(btn.textContent || '');
      parts.push(btn.getAttribute('aria-label') || '');
    });
  }

  return parts.join(' ').toLowerCase();
}

function scoreField(el: HTMLElement, contextText: string): { score: number; context: DetectedField['context'] } {
  let score = 0;
  const context: DetectedField['context'] = {
    isEmail: false,
    isChat: false,
    isComment: false,
    isPost: false,
    isSearch: false,
    platform: detectPlatform(),
  };

  // Size check
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) {
    score -= 50; // Likely search or small input
  }
  if (rect.height > 100) score += 10; // Tall = likely compose

  // Compose signals
  for (const signal of COMPOSE_SIGNALS) {
    if (contextText.includes(signal)) {
      score += 15;
    }
  }

  // Search signals (disqualify)
  for (const signal of SEARCH_SIGNALS) {
    if (contextText.includes(signal)) {
      score -= 30;
      context.isSearch = true;
    }
  }

  // Type-specific detection
  if (contextText.includes('email') || contextText.includes('subject') || contextText.includes('to:')) {
    context.isEmail = true;
    score += 20;
  }
  if (contextText.includes('message') || contextText.includes('chat') || contextText.includes('dm')) {
    context.isChat = true;
    score += 15;
  }
  if (contextText.includes('comment') || contextText.includes('reply')) {
    context.isComment = true;
    score += 10;
  }
  if (contextText.includes('post') || contextText.includes('publish')) {
    context.isPost = true;
    score += 10;
  }

  // Has a nearby Send/Submit button?
  const container = el.closest('form, [role="dialog"], [class*="compose"]') || el.parentElement;
  if (container) {
    const sendBtn = container.querySelector(
      'button[type="submit"], [data-qa*="send"], [aria-label*="Send"], [class*="send"]'
    );
    if (sendBtn) score += 25;
  }

  // Is focused? Bonus for active fields
  if (document.activeElement === el) score += 10;

  // ContentEditable gets a baseline bonus (more likely to be compose than textarea)
  if (el.getAttribute('contenteditable') === 'true') score += 5;

  return { score, context };
}

/**
 * Scan the page for qualifying text input fields.
 * Returns fields sorted by score (highest first).
 */
export function detectTextFields(): DetectedField[] {
  const fields: DetectedField[] = [];

  // 1. ContentEditable elements
  const editables = document.querySelectorAll('[contenteditable="true"]');
  editables.forEach(el => {
    const htmlEl = el as HTMLElement;
    if (!htmlEl.offsetParent) return; // Not visible
    const contextText = getElementContext(htmlEl);
    const { score, context } = scoreField(htmlEl, contextText);
    if (score > 0 && !context.isSearch) {
      fields.push({ element: htmlEl, type: 'contenteditable', score, context });
    }
  });

  // 2. Textareas (excluding search)
  const textareas = document.querySelectorAll('textarea');
  textareas.forEach(el => {
    const htmlEl = el as HTMLElement;
    if (!htmlEl.offsetParent) return;
    const contextText = getElementContext(htmlEl);
    const { score, context } = scoreField(htmlEl, contextText);
    if (score > 0 && !context.isSearch) {
      fields.push({ element: htmlEl, type: 'textarea', score, context });
    }
  });

  // Sort by score descending
  fields.sort((a, b) => b.score - a.score);

  return fields;
}

/**
 * Get the best compose field on the current page.
 * Returns null if no qualifying field found.
 */
export function getBestComposeField(): DetectedField | null {
  const fields = detectTextFields();
  return fields.length > 0 ? fields[0] : null;
}

/**
 * Monitor the page for new text fields appearing (SPA navigation).
 * Returns cleanup function.
 */
export function monitorForTextFields(
  onFieldDetected: (field: DetectedField) => void,
  checkIntervalMs = 1500
): () => void {
  let knownFields = new WeakSet<HTMLElement>();
  let isDestroyed = false;

  function scan() {
    if (isDestroyed) return;
    const fields = detectTextFields();
    for (const field of fields) {
      if (!knownFields.has(field.element) && field.score > 20) {
        knownFields.add(field.element);
        onFieldDetected(field);
      }
    }
  }

  // Initial scan
  scan();

  // Periodic re-scan (handles SPA navigations and dynamic content)
  const interval = setInterval(scan, checkIntervalMs);

  // MutationObserver for faster detection
  const observer = new MutationObserver(() => {
    // Debounce mutation-triggered scans
    setTimeout(scan, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    isDestroyed = true;
    clearInterval(interval);
    observer.disconnect();
  };
}
