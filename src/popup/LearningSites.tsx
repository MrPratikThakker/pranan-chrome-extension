/**
 * "Sites Pranan can learn from" (Phase 3, src/lib/work-sites.ts).
 *
 * Adding a site asks Chrome for access to that one site; Chrome shows its own
 * prompt. On an added site, a "Remember this page" button appears, and only a
 * click on it sends that page's visible text to Pranan. Removing a site takes
 * the access back at once.
 */
import React, { useEffect, useState } from 'react';
import {
  addLearningSite,
  listLearningSites,
  removeLearningSite,
  siteFromInput,
  type SiteChoice,
} from '@/lib/work-sites';

const box: React.CSSProperties = { marginTop: 10, padding: '10px 12px', borderRadius: 6, background: 'rgba(10,10,11,0.03)', border: '1px solid rgba(10,10,11,0.08)' };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(10,10,11,0.5)', marginBottom: 6 };
const hint: React.CSSProperties = { display: 'block', fontSize: 10, color: 'rgba(10,10,11,0.5)', lineHeight: 1.4, marginTop: 4 };
const smallBtn: React.CSSProperties = { fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(10,10,11,0.12)', background: '#fff', cursor: 'pointer' };

export function LearningSites() {
  const [sites, setSites] = useState<SiteChoice[] | null>(null);
  const [input, setInput] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => listLearningSites().then(setSites).catch(() => setSites([]));
  useEffect(() => { void refresh(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = siteFromInput(input);
    if (!parsed.ok) { setNote(parsed.reason); return; }
    setBusy(true);
    setNote(null);
    try {
      const granted = await addLearningSite(parsed.site);
      setNote(granted ? `Added. Open ${parsed.site.host} and press "Remember this page" on any page you want Pranan to learn from.` : 'Chrome did not allow it, so nothing changed.');
      if (granted) setInput('');
    } catch {
      setNote('Could not add that site. Try again.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const remove = async (site: SiteChoice) => {
    setBusy(true);
    try {
      await removeLearningSite(site);
      setNote(`Removed ${site.host}. Pranan can no longer read it.`);
    } catch {
      setNote('Could not remove that site. Try again.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div style={box}>
      <div style={label}>Sites Pranan can learn from</div>
      <span style={{ ...hint, marginTop: 0, marginBottom: 6 }}>
        On these sites a &quot;Remember this page&quot; button appears. Only pages you click it on are read, and what Pranan finds waits in your Memory inbox for approval.
      </span>
      {sites && sites.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0 }}>
          {sites.map((site) => (
            <li key={site.pattern} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 12, padding: '3px 0' }}>
              <span>{site.host}</span>
              <button type="button" disabled={busy} onClick={() => { void remove(site); }} style={smallBtn}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { void add(e); }} style={{ display: 'flex', gap: 6 }}>
        <label htmlFor="pranan-learn-site" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Site to add</label>
        <input
          id="pranan-learn-site"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. notion.so"
          style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(10,10,11,0.15)' }}
        />
        <button type="submit" disabled={busy || !input.trim()} style={smallBtn}>Add</button>
      </form>
      {note && <span role="status" style={hint}>{note}</span>}
    </div>
  );
}
