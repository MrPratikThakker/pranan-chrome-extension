import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftPanel } from '../src/components/DraftPanel';
import '../src/styles/globals.css';
function Preview() {
  const [inserted, setInserted] = useState('');
  return <main style={{ maxWidth: 1000, margin: 'auto', padding: 20 }}>
    <h1 style={{ fontSize: 24, marginBottom: 8 }}>Pranan extension QA preview</h1>
    <p style={{ marginBottom: 24 }}>Local component preview. Sample data. No email sending or account access.</p>
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <section style={{ width: 360, maxWidth: '100%', padding: 16, border: '1px solid #343444', borderRadius: 12 }}>
        <div style={{ height: 540 }}><DraftPanel draft={{ draft: 'Hi Sam,\n\nThanks for the update. I will review the proposal and get back to you.\n\nBest,\nPratik', confidence: 0, voiceMatch: 0, alternativeTones: [] }} isLoading={false} recipientName="Sam (sample)" recipientEmail="sam@example.com" onInsert={(text, done) => { setInserted(text); done?.(true); }} onRegenerate={() => {}} onBack={() => {}} /></div>
        <label htmlFor="inserted">Insertion result (local only)</label><textarea id="inserted" aria-label="Insertion result" readOnly value={inserted} style={{ width: '100%', minHeight: 130, padding: 12, marginTop: 8, color: '#111827', borderRadius: 8 }} />
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
