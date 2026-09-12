/** Shared production layout, also rendered by the screenshot regression fixture. */
export function compactPromptBar(parts: {
  bar: HTMLElement; icon: HTMLElement; input: HTMLInputElement;
  generate: HTMLButtonElement; relationship: HTMLElement; tone: HTMLElement;
  sidePanel: HTMLButtonElement;
}) {
  const { bar, icon, input, generate, relationship, tone, sidePanel } = parts;
  bar.style.cssText = 'display:flex;flex-direction:column;gap:0;box-sizing:border-box;width:640px;max-width:100%;padding:5px 8px;margin:6px 0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#334155;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;min-width:0;';
  icon.style.cssText = 'display:flex;align-items:center;justify-content:center;width:22px;height:28px;flex-shrink:0;';
  icon.title = 'Pranan';
  input.style.cssText = 'flex:1 1 160px;min-width:60px;width:0;height:32px;box-sizing:border-box;padding:0 6px;border:1px solid transparent;border-radius:5px;font-family:inherit;font-size:13px;line-height:1.4;color:#1f2937;background:white;';
  generate.style.cssText = 'flex-shrink:0;min-height:30px;padding:5px 10px;border:0;border-radius:6px;font-family:inherit;font-size:12px;line-height:1.4;font-weight:500;background:#6d28d9;color:#fff;cursor:pointer;';
  const options = document.createElement('button');
  options.type = 'button';
  options.textContent = '···';
  options.setAttribute('aria-label', 'Reply options and suggestions');
  options.title = 'Reply options and suggestions';
  options.style.cssText = 'flex-shrink:0;width:28px;height:30px;padding:0;border:0;border-radius:5px;background:#f8fafc;color:#475569;font-family:inherit;font-size:18px;line-height:1;font-weight:600;cursor:pointer;';
  const detail = document.createElement('div');
  detail.id = `pranan-options-${crypto.randomUUID()}`;
  detail.style.cssText = 'display:none;flex-direction:column;gap:8px;padding:8px 0 3px;margin-top:5px;border-top:1px solid #f1f5f9;min-width:0;';
  options.setAttribute('aria-controls', detail.id);
  const setExpanded = (expanded: boolean) => {
    options.setAttribute('aria-expanded', String(expanded));
    detail.style.display = expanded ? 'flex' : 'none';
  };
  setExpanded(false);
  options.addEventListener('click', (event) => {
    event.stopPropagation();
    setExpanded(options.getAttribute('aria-expanded') !== 'true');
  });
  detail.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setExpanded(false);
      options.focus();
    }
  });
  const context = document.createElement('div');
  context.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;';
  relationship.style.cssText = 'display:inline-flex;align-items:center;gap:5px;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;text-align:left;padding:4px 6px;border:1px solid #ede9fe;border-radius:5px;background:#faf5ff;color:#6d28d9;font-family:inherit;font-size:12px;line-height:1.4;cursor:pointer;';
  tone.style.cssText = 'font-family:inherit;font-size:12px;line-height:1.4;color:#64748b;';
  sidePanel.textContent = 'Open side panel';
  sidePanel.style.cssText = 'padding:4px 6px;border:0;border-radius:5px;background:#f8fafc;color:#475569;font-family:inherit;font-size:12px;line-height:1.4;cursor:pointer;';
  context.append(relationship, tone, sidePanel);
  const suggestions = document.createElement('div');
  suggestions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;min-width:0;';
  detail.append(context, suggestions);
  row.append(icon, input, generate, options);
  bar.replaceChildren(row, detail);
  return {
    setIntents(intents: string[], onSelect: (intent: string) => void) {
      suggestions.replaceChildren();
      for (const intent of intents.slice(0, 3)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = intent;
        button.style.cssText = 'max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:left;padding:5px 8px;border:1px solid #ede9fe;border-radius:6px;background:#faf5ff;color:#6d28d9;font-family:inherit;font-size:12px;line-height:1.4;cursor:pointer;';
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          if (input.disabled || generate.disabled) return;
          setExpanded(false);
          input.focus();
          onSelect(intent);
        });
        suggestions.append(button);
      }
    },
  };
}
