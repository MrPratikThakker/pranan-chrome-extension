/**
 * "On pages": turn Pranan's prompt bars on Gmail, Slack and LinkedIn back on
 * after their x hid them (src/lib/page-bar-prefs.ts). Turning one off takes it
 * off open pages at once; turning it on shows it on the next email or message box.
 */
import React, { useEffect, useState } from 'react';
import { getHiddenPageBars, setPageBarShown, PAGE_BARS, PAGE_BAR_LABELS, type PageBar } from '@/lib/page-bar-prefs';

const box: React.CSSProperties = { marginTop: 10, padding: '10px 12px', borderRadius: 6, background: 'rgba(10,10,11,0.03)', border: '1px solid rgba(10,10,11,0.08)' };
const label: React.CSSProperties = { fontSize: 9, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(10,10,11,0.4)', marginBottom: 2 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8, fontSize: 11, fontWeight: 500, color: 'rgba(10,10,11,0.8)', cursor: 'pointer' };
const hint: React.CSSProperties = { display: 'block', marginTop: 2, fontSize: 10, fontWeight: 400, color: 'rgba(10,10,11,0.45)' };

export function PageBars() {
  const [hidden, setHidden] = useState<PageBar[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { getHiddenPageBars().then(setHidden).catch(() => setHidden([])); }, []);

  const toggle = async (bar: PageBar, shown: boolean) => {
    setNote(null);
    setHidden((h) => (h ? (shown ? h.filter((b) => b !== bar) : [...h, bar]) : h));
    try {
      setHidden(await setPageBarShown(bar, shown));
    } catch {
      setNote('Could not change that. Try again.');
      getHiddenPageBars().then(setHidden).catch(() => {});
    }
  };

  return (
    <div style={box}>
      <div style={label}>On pages</div>
      <span style={hint}>Pranan's prompt bars. The x on a bar turns it off here.</span>
      {PAGE_BARS.map((bar) => (
        <label key={bar} style={row}>
          <input
            type="checkbox"
            disabled={hidden === null}
            checked={hidden !== null && !hidden.includes(bar)}
            onChange={(e) => { void toggle(bar, e.target.checked); }}
          />
          <span>
            {PAGE_BAR_LABELS[bar].label}
            <span style={hint}>{PAGE_BAR_LABELS[bar].site}</span>
          </span>
        </label>
      ))}
      {note && <span role="status" style={hint}>{note}</span>}
    </div>
  );
}
