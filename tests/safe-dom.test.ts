/**
 * Tests for safe-dom helpers.
 * These guard against the Slack injectDraft XSS-shape bug we fixed in v0.3.2:
 * user-controlled '<' or '>' must render as literal text, not be parsed as HTML.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { injectMultilineText } from '@/lib/safe-dom';

describe('injectMultilineText', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders each line in its own block element', () => {
    injectMultilineText(host, 'line one\nline two\nline three');
    expect(host.children.length).toBe(3);
    expect(host.children[0].tagName).toBe('DIV');
    expect(host.children[0].textContent).toBe('line one');
    expect(host.children[2].textContent).toBe('line three');
  });

  it('uses the requested tag (e.g. p for Slack quill editor)', () => {
    injectMultilineText(host, 'a\nb', 'p');
    expect(host.children[0].tagName).toBe('P');
    expect(host.children[1].tagName).toBe('P');
  });

  it('preserves blank lines as <br> blocks', () => {
    injectMultilineText(host, 'first\n\nthird');
    expect(host.children.length).toBe(3);
    expect(host.children[1].children[0]?.tagName).toBe('BR');
  });

  it('clears existing children before injecting', () => {
    host.innerHTML = '<span>old content</span><span>more</span>';
    injectMultilineText(host, 'replaced');
    expect(host.children.length).toBe(1);
    expect(host.textContent).toBe('replaced');
  });

  it('renders HTML-shaped user text as literal characters (XSS guard)', () => {
    injectMultilineText(host, '<script>alert(1)</script>\n<img src=x onerror=fail>');
    // Both lines must remain as text — no <script> or <img> in the DOM.
    expect(host.querySelectorAll('script').length).toBe(0);
    expect(host.querySelectorAll('img').length).toBe(0);
    // The text content should have the angle brackets verbatim.
    expect(host.children[0].textContent).toContain('<script>');
    expect(host.children[1].textContent).toContain('<img');
  });

  it('handles empty string without throwing', () => {
    expect(() => injectMultilineText(host, '')).not.toThrow();
    expect(host.children.length).toBe(1);
    expect(host.children[0].children[0]?.tagName).toBe('BR');
  });
});
