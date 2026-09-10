import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftPanel } from '../src/components/DraftPanel';
import { attachVoicePrompt } from '../src/content/shared/voice-prompt';
import '../src/styles/globals.css';
function Preview() {
  const [inserted, setInserted] = useState('');
  const voice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = voice.current!;
    return attachVoicePrompt(host.querySelector('textarea')!, host);
  }, []);
  return <main style={{ maxWidth: 1000, margin: 'auto', padding: 20 }}>
    <h1 style={{ fontSize: 24, marginBottom: 8 }}>Pranan extension QA preview</h1>
    <p style={{ marginBottom: 24 }}>Local component preview. Sample data. No email sending or account access.</p>
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <section style={{ width: 360, maxWidth: '100%', padding: 16, border: '1px solid #343444', borderRadius: 12 }}>
        <div style={{ height: 540 }}><DraftPanel draft={{ draft: 'Hi Sam,\n\nThanks for the update. I will review the proposal and get back to you.\n\nBest,\nPratik', confidence: 0, voiceMatch: 0, alternativeTones: [] }} isLoading={false} recipientName="Sam (sample)" recipientEmail="sam@example.com" onInsert={(text, done) => { setInserted(text); done?.(true); }} onRegenerate={() => {}} onBack={() => {}} /></div>
        <label htmlFor="inserted">Insertion result (local only)</label><textarea id="inserted" aria-label="Insertion result" readOnly value={inserted} style={{ width: '100%', minHeight: 130, padding: 12, marginTop: 8, color: '#111827', borderRadius: 8 }} />
      </section>
      <section ref={voice} style={{ width: 420, maxWidth: '100%', alignSelf: 'flex-start', background: '#fff', borderRadius: 12, padding: 20, color: '#334155' }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Speak, review, then draft</h2>
        <label htmlFor="instructions">Instructions for Pranan</label>
        <textarea id="instructions" aria-label="Instructions for Pranan" placeholder="Tell Pranan what you want to say" style={{ boxSizing: 'border-box', width: '100%', minHeight: 130, padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, marginTop: 8, color: '#111827' }} />
        <p style={{ marginTop: 16, fontSize: 12 }}>Voice beta. Microphone transcription must still be verified in the installed extension.</p>
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
