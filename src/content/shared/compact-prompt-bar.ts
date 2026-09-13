/** Shared production layout, also rendered by the screenshot regression fixture. */
export function compactPromptBar(parts: {
  bar: HTMLElement; icon: HTMLElement; input: HTMLInputElement;
  generate: HTMLButtonElement; relationship: HTMLElement; tone: HTMLElement;
  sidePanel: HTMLButtonElement;
}) {
  const { bar, icon, input, generate, relationship, tone, sidePanel } = parts;
  bar.classList.add('pranan-compact');
  bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Pranan email assistant');
  if (!document.getElementById('pranan-compact-theme')) {
    const style = document.createElement('style'); style.id = 'pranan-compact-theme';
    style.textContent = `
      .pranan-compact { --pranan-bg:#fff; --pranan-fg:#1f2937; --pranan-muted:#f5f3ff; --pranan-border:#d1d5db; --pranan-secondary:#475569; background:var(--pranan-bg)!important; color:var(--pranan-fg)!important; border-color:var(--pranan-border)!important; }
      .pranan-compact input,.pranan-compact select { color:var(--pranan-fg)!important; background:var(--pranan-bg)!important; }
      .pranan-compact input::placeholder { color:var(--pranan-secondary); opacity:1; }
      .pranan-compact :is(button,input,select):focus-visible { outline:2px solid #7c3aed; outline-offset:2px; }
      .pranan-compact button { min-height:30px; }
      .pranan-compact button[hidden] { display:none!important; }
      .pranan-compact button:disabled { opacity:.55; cursor:wait!important; }
      .pranan-compact .pranan-actions button { border:1px solid var(--pranan-border); border-radius:5px; padding:4px 6px; color:var(--pranan-fg); background:var(--pranan-bg); font:inherit; cursor:pointer; }
      .pranan-compact[data-theme="dark"] { --pranan-bg:#202124; --pranan-fg:#f3f4f6; --pranan-muted:#30234b; --pranan-border:#6b7280; --pranan-secondary:#cbd5e1; }
      .pranan-compact[data-theme="dark"] button:not([data-pranan-primary]) { background:#30234b!important; color:#ede9fe!important; border-color:#6b7280!important; }
      @media (prefers-color-scheme:dark) {
        .pranan-compact:not([data-theme="light"]) { --pranan-bg:#202124; --pranan-fg:#f3f4f6; --pranan-muted:#30234b; --pranan-border:#6b7280; --pranan-secondary:#cbd5e1; }
        .pranan-compact:not([data-theme="light"]) button:not([data-pranan-primary]) { background:#30234b!important; color:#ede9fe!important; border-color:#6b7280!important; }
      }
      @media (forced-colors:active) { .pranan-compact :is(button,input,select) { border:1px solid ButtonText!important; } }
      @media (max-width:600px) { .pranan-compact .pranan-brand { display:none; } }
    `;
    document.head.append(style);
  }
  generate.setAttribute('data-pranan-primary', '1');
  icon.setAttribute('aria-hidden', 'true');

  bar.style.cssText = 'display:flex;flex-direction:column;gap:0;box-sizing:border-box;width:100%;max-width:100%;padding:5px 8px;margin:6px 0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#334155;';
  const row = document.createElement('div');
  const brand = document.createElement('span'); brand.className = 'pranan-brand'; brand.textContent = 'Pranan'; brand.style.cssText = 'font-weight:600;font-size:12px;';
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
  tone.style.cssText = 'font-family:inherit;font-size:12px;line-height:1.4;color:var(--pranan-secondary,#475569);';
  sidePanel.textContent = 'Open side panel';
  sidePanel.style.cssText = 'padding:4px 6px;border:0;border-radius:5px;background:#f8fafc;color:#475569;font-family:inherit;font-size:12px;line-height:1.4;cursor:pointer;';
  const toneLabel = document.createElement('label'); toneLabel.textContent = 'Tone ';
  const toneSelect = document.createElement('select'); toneSelect.setAttribute('aria-label', 'Reply tone');
  for (const value of ['Auto', 'Warm', 'Direct', 'Formal']) {
    const option = document.createElement('option'); option.value = value === 'Auto' ? '' : value.toLowerCase(); option.textContent = value; toneSelect.append(option);
  }
  toneLabel.append(toneSelect);
  const toneKey = 'replyTone:' + (document.title.match(/[^\s<>]+@[^\s<>]+\.[a-z]{2,}/gi)?.pop() || 'default');
  try {
    chrome.storage.local.get(toneKey).then(saved => {
      if (['', 'warm', 'direct', 'formal'].includes(saved[toneKey])) toneSelect.value = saved[toneKey];
    }).catch(() => {});
    toneSelect.addEventListener('change', () => { chrome.storage.local.set({ [toneKey]: toneSelect.value }).catch(() => {}); });
  } catch { /* fixture or unavailable extension storage */ }
  tone.replaceChildren(toneLabel);
  const savedText = document.createElement('a'); savedText.textContent = 'Manage saved text';
  savedText.href = 'https://app.pranan.ai/settings/snippets'; savedText.target = '_blank'; savedText.rel = 'noopener noreferrer';
  savedText.style.cssText = 'color:var(--pranan-secondary,#475569);font-size:12px;';
  context.append(relationship, tone, sidePanel, savedText);
  const suggestions = document.createElement('div');
  suggestions.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;min-width:0;';
  const actions = document.createElement('div'); actions.className = 'pranan-actions'; actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
  const secondaryActions = document.createElement('div'); secondaryActions.className = 'pranan-actions'; secondaryActions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
  detail.append(context, suggestions, secondaryActions);
  row.append(icon, brand, input, generate, actions, options);
  bar.replaceChildren(row, detail);
  return {
    actions, secondaryActions,
    getTone: () => toneSelect.value || undefined,
    setRefinements(labels: string[], onSelect: (label: string) => void) {
      for (const label of labels) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => { if (input.disabled || generate.disabled) return; setExpanded(false); onSelect(label); });
        secondaryActions.append(button);
      }
    },
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
