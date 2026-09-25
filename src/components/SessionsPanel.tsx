import React, { useCallback, useEffect, useState } from 'react';
import { appUrl } from '@/lib/config';
import { getActiveSessions, revokeActiveSession } from '@/lib/api-client';
import type { ActiveSession } from '@/types';

function label(session: ActiveSession): string {
  if (session.kind === 'companion') return 'Pranan for Chrome';
  if (/mobile|android|iphone|ipad/i.test(session.userAgent ?? '')) return 'Mobile browser';
  if (/chrome/i.test(session.userAgent ?? '')) return 'Chrome browser';
  if (/safari/i.test(session.userAgent ?? '')) return 'Safari browser';
  return 'Web browser';
}

function formatted(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function SessionsPanel({ onBack, onCurrentRevoked }: { onBack: () => void; onCurrentRevoked: () => void }) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setSessions(await getActiveSessions()); setMessage(''); }
    catch { setMessage('Could not load sessions.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reauth = () => chrome.tabs.create({ url: appUrl('/login?reauth=1&redirectTo=/settings/security') });

  const revoke = async (session: ActiveSession) => {
    setBusy(session.id);
    try {
      const result = await revokeActiveSession(session.current ? 'current' : 'revoke', session.current ? undefined : session.id);
      if (result === 'reauth') return reauth();
      if (session.current) return onCurrentRevoked();
      setMessage('Session revoked.');
      await load();
    } catch { setMessage('Could not revoke that session.'); }
    finally { setBusy(null); }
  };

  const all = async () => {
    setBusy('all');
    try {
      const result = await revokeActiveSession('all');
      if (result === 'reauth') return reauth();
      onCurrentRevoked();
    } catch { setMessage('Could not sign out all devices.'); }
    finally { setBusy(null); }
  };

  return (
    <section aria-labelledby="sessions-heading" className="animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <button onClick={onBack} className="text-[10px] text-brand-text-3 hover:text-brand-text mb-2">Back</button>
          <h2 id="sessions-heading" className="text-sm font-medium text-brand-text">Active Sessions</h2>
          <p className="text-[10px] leading-relaxed text-brand-text-3 mt-1">Revocation does not disconnect Gmail, Slack, or HubSpot.</p>
          <p className="text-[10px] leading-relaxed text-brand-text-3 mt-1">Signing out of app.pranan.ai does not sign out this extension. Use Sign out here or Disconnect in the toolbar popup.</p>
        </div>
        <button onClick={all} disabled={busy !== null || sessions.length === 0} className="text-[10px] px-2.5 py-1.5 rounded border border-brand-red/30 text-brand-red hover:bg-brand-red/10 disabled:opacity-40">
          Sign out all
        </button>
      </div>
      <p aria-live="polite" className="min-h-4 text-[10px] text-brand-text-3 mb-2">{message}</p>
      {loading ? <p role="status" className="text-xs text-brand-text-3 py-8 text-center">Loading sessions...</p> : (
        <ul className="space-y-2" aria-label="Signed-in sessions">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-md border border-brand-border bg-brand-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-brand-text font-medium">
                    {label(session)} {session.current && <span className="text-brand-accent">(current)</span>}
                  </p>
                  <p className="text-[10px] text-brand-text-3 mt-1">Last active {formatted(session.lastSeenAt)}</p>
                  <p className="text-[10px] text-brand-text-3">Expires {formatted(session.absoluteExpiresAt)}</p>
                </div>
                <button onClick={() => revoke(session)} disabled={busy !== null} className="text-[10px] px-2 py-1 rounded border border-brand-border hover:bg-brand-surface-2 disabled:opacity-40">
                  {busy === session.id ? 'Working...' : (session.current ? 'Sign out' : 'Revoke')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
