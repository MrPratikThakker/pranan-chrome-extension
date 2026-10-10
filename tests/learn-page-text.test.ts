import { describe, expect, it } from 'vitest';
import { looksLikeLoginPage, MAX_PAGE_TEXT, pageText } from '@/content/learn/page-text';

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument('t');
  d.body.innerHTML = html;
  return d;
}

describe('pageText', () => {
  it('prefers the main content and drops scripts, inputs and hidden text', () => {
    const d = doc(`
      <nav>Home Pricing Login</nav>
      <main>
        <h1>Northwind account plan</h1>
        <p>We   chose annual billing for Northwind and Leo Tan needs SSO before signing.</p>
        <script>window.secret = 1</script>
        <input value="typed secret">
        <div hidden>hidden note</div>
        <span aria-hidden="true">decorative</span>
      </main>`);
    const text = pageText(d);
    expect(text).toContain('Northwind account plan');
    expect(text).toContain('We chose annual billing');
    // Blocks stay separate lines, not "planWe chose".
    expect(text).toMatch(/Northwind account plan\n+We chose/);
    expect(text).not.toContain('Pricing');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('hidden note');
    expect(text).not.toContain('decorative');
  });

  it('falls back to the body and caps the length', () => {
    const d = doc(`<div>${'word '.repeat(5000)}</div>`);
    expect(pageText(d).length).toBe(MAX_PAGE_TEXT);
  });
});

describe('looksLikeLoginPage', () => {
  it('spots password and card fields', () => {
    expect(looksLikeLoginPage(doc('<form><input type="password"></form>'))).toBe(true);
    expect(looksLikeLoginPage(doc('<input autocomplete="cc-number">'))).toBe(true);
    expect(looksLikeLoginPage(doc('<p>Plain page</p>'))).toBe(false);
  });
});
