import { createVoiceInstructions, recognitionConstructor } from '@/lib/voice-instructions';

/** Adds opt-in dictation beside a prompt; returned cleanup ends any recording. */
export function attachVoicePrompt(prompt: HTMLTextAreaElement, container: HTMLElement): () => void {
  const controls = document.createElement('div');
  controls.style.cssText = 'margin-top:8px;font:12px/1.5 system-ui;color:#475569;';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.textContent = 'Speak instructions (beta)';
  toggle.style.cssText = 'border:1px solid #ddd6fe;border-radius:6px;background:#faf5ff;color:#6d28d9;padding:6px 10px;cursor:pointer;';
  const detail = document.createElement('div'); detail.hidden = true;
  const disclosure = document.createElement('p');
  disclosure.textContent = 'Uses your microphone and Chrome’s speech service, which may process audio online. Only the transcript goes into these instructions. Nothing is generated or sent automatically.';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const start = document.createElement('button'); start.type = 'button'; start.textContent = 'Start dictation';
  const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'Stop'; stop.hidden = true;
  for (const button of [start, stop]) button.style.cssText = 'border:1px solid #cbd5e1;border-radius:6px;padding:5px 10px;background:white;color:#334155;margin-right:6px;cursor:pointer;';
  const Recognition = recognitionConstructor();
  const voice = Recognition ? createVoiceInstructions({
    Recognition, language: navigator.language || 'en-US',
    onText(text) {
      if (!container.isConnected) return;
      prompt.value = [prompt.value.trim(), text].filter(Boolean).join('\n');
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    },
    onStatus(text, active) { status.textContent = text; start.disabled = active; stop.hidden = !active; },
  }) : null;
  if (!voice) { start.disabled = true; status.textContent = 'Dictation is unavailable in this browser. You can type your instructions.'; }
  start.addEventListener('click', () => voice?.start());
  stop.addEventListener('click', () => voice?.stop());
  toggle.addEventListener('click', () => { detail.hidden = !detail.hidden; toggle.setAttribute('aria-expanded', String(!detail.hidden)); if (detail.hidden) voice?.cancel(); });
  toggle.setAttribute('aria-expanded', 'false');
  detail.append(disclosure, start, stop, status); controls.append(toggle, detail); prompt.after(controls);
  const onHidden = () => { if (document.hidden) voice?.cancel(); };
  document.addEventListener('visibilitychange', onHidden);
  const cleanup = () => { voice?.cancel(); observer.disconnect(); document.removeEventListener('visibilitychange', onHidden); };
  const observer = new MutationObserver(() => { if (!container.isConnected) cleanup(); });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => voice?.cancel();
}
