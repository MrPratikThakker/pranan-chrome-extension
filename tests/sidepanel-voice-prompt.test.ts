// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoicePromptField } from '../src/components/VoicePromptField';

let recognition: {
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

class Recognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { recognition = this; }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
}

let host: HTMLDivElement;
let root: Root;

function Harness({ submit }: { submit: () => void }) {
  const [value, setValue] = useState('Please');
  return React.createElement(VoicePromptField, { value, onChange: setValue, onSubmit: submit });
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).webkitSpeechRecognition = Recognition;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(Harness, { submit: vi.fn() })); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as any).webkitSpeechRecognition;
});

it('adds an editable voice transcript to the existing instruction', async () => {
  const voice = host.querySelector<HTMLButtonElement>('[aria-label="Dictate Pranan instructions"]')!;
  await act(async () => { voice.click(); });
  expect(voice.getAttribute('aria-pressed')).toBe('true');
  expect(voice.textContent).toBe('Stop voice');

  await act(async () => {
    recognition.onresult?.({ results: [{ 0: { transcript: 'thank them and confirm Friday' }, isFinal: true }] });
  });
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Please thank them and confirm Friday');

  await act(async () => { voice.click(); });
  expect(voice.getAttribute('aria-pressed')).toBe('false');
  expect(host.textContent).toContain('Voice captured');
});

it('submits the reviewed instruction with Enter', async () => {
  const submit = vi.fn();
  await act(async () => { root.render(React.createElement(Harness, { submit })); });
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(submit).toHaveBeenCalledOnce();
});
