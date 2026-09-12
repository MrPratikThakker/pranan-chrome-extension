// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { compactPromptBar } from '../src/content/shared/compact-prompt-bar';
function setup() {
  const bar = document.createElement('div');
  const input = document.createElement('input');
  const generate = document.createElement('button');
  const relationship = document.createElement('button');
  const sidePanel = document.createElement('button');
  const panelClick = vi.fn(); sidePanel.addEventListener('click', panelClick);
  const layout = compactPromptBar({ bar, input, generate, relationship, sidePanel,
    icon: document.createElement('div'), tone: document.createElement('span') });
  document.body.replaceChildren(bar);
  const toggle = bar.querySelector<HTMLButtonElement>('[aria-expanded]')!;
  const details = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  return { bar, input, generate, layout, toggle, details, sidePanel, panelClick };
}
it('keeps arriving suggestions collapsed until opened and restores focus on Escape', () => {
  const { layout, toggle, details, sidePanel, panelClick } = setup();
  layout.setIntents(['Share pricing'], vi.fn());
  expect(details.style.display).toBe('none');
  toggle.click(); expect(toggle.getAttribute('aria-expanded')).toBe('true');
  sidePanel.click(); expect(panelClick).toHaveBeenCalledOnce();
  sidePanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(details.style.display).toBe('none'); expect(document.activeElement).toBe(toggle);
});
it('selects the exact intent once and collapses without losing typed instructions', () => {
  const { layout, toggle, details, input } = setup();
  input.value = 'Keep it brief'; const select = vi.fn();
  layout.setIntents(['Share pricing'], select);
  toggle.click(); details.querySelectorAll('button')[2].click();
  expect(select).toHaveBeenCalledExactlyOnceWith('Share pricing');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(input.value).toBe('Keep it brief');
});
it('does not start another generation from suggestions while busy', () => {
  const { layout, toggle, details, generate } = setup(); const select = vi.fn();
  layout.setIntents(['Share pricing'], select); generate.disabled = true;
  toggle.click(); details.querySelectorAll('button')[2].click();
  expect(select).not.toHaveBeenCalled();
});
