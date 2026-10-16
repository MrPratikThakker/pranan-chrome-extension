/**
 * "Sites Pranan can learn from" (Phase 3, src/lib/work-sites.ts).
 *
 * Adding a site asks Chrome for access to that one site; Chrome shows its own
 * prompt. On an added site, a small "Remember this page" tab sits on the right
 * edge, and only a click on it sends that page's visible text to Pranan.
 * "Hide on this site" on that tab is remembered; "Show button" here undoes it.
 * Removing a site takes the access back at once.
 */
import React, { useEffect, useState } from 'react';
import {
  addLearningSite,
  getHiddenLearnHosts,
  hiddenHostsForSite,
  listLearningSites,
  removeLearningSite,
  showLearnButtonOnSite,
  siteFromInput,
  type SiteChoice,
} from '@/lib/work-sites';

const box: React.CSSProperties = { marginTop: 10, padding: '10px 12px', borderRadius: 6, background: 'rgba(10,10,11,0.03)', border: '1px solid rgba(10,10,11,0.08)' };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(10,10,11,0.5)', marginBottom: 6 };
const hint: React.CSSProperties = { display: 'block', fontSize: 10, color: 'rgba(10,10,11,0.5)', lineHeight: 1.4, marginTop: 4 };
const smallBtn: React.CSSProperties = { fontSize: 11, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(10,10,11,0.12)', background: '#fff', cursor: 'pointer' };

export function LearningSites() {
  const [sites, setSites] = useState<SiteChoice[] | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    getHiddenLearnHosts().then(setHidden).catch(() => setHidden([]));
    return listLearningSites().then(setSites).catch(() => setSites([]));
  };
  useEffect(() => { void refresh(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = siteFromInput(input);
    if (!parsed.ok) { setNote(parsed.reason); return; }
    setBusy(true);
    setNote(null);
    try {
      const granted = await addLearningSite(parsed.site);
      setNote(granted ? `Added. Open ${parsed.site.host} and use the Pranan tab on the right edge of any page you want Pranan to learn from.` : 'Chrome did not allow it, so nothing changed.');
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
      await showLearnButtonOnSite(site).catch(() => {});
      setNote(`Removed ${site.host}. Pranan can no longer read it.`);
    } catch {
      setNote('Could not remove that site. Try again.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const showButton = async (site: SiteChoice) => {
    setBusy(true);
    try {
      await showLearnButtonOnSite(site);
      setNote(`The Pranan tab is back on ${site.host}. Reload any open ${site.host} pages to see it.`);
    } catch {
      setNote('Could not change that. Try again.');
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div style={box}>
      <div style={label}>Sites Pranan can learn from</div>
      <span style={{ ...hint, marginTop: 0, marginBottom: 6 }}>
        On these sites a small Pranan tab sits on the right edge of the page. Only pages where you click &quot;Remember this page&quot; are read, and what Pranan finds waits in your Memory inbox for approval.
      </span>
      {sites && sites.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0 }}>
          {sites.map((site) => (
            <li key={site.pattern} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 12, padding: '3px 0' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {site.host}
                {hiddenHostsForSite(site, hidden).length > 0 && <span style={{ color: 'rgba(10,10,11,0.5)' }}> · tab hidden</span>}
              </span>
              <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
                {hiddenHostsForSite(site, hidden).length > 0 && (
                  <button type="button" disabled={busy} onClick={() => { void showButton(site); }} style={smallBtn}>Show button</button>
                )}
                <button type="button" disabled={busy} onClick={() => { void remove(site); }} style={smallBtn}>Remove</button>
              </span>
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
