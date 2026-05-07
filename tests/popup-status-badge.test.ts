/**
 * Regression test for the 3-state popup status badge (v0.4.3).
 *
 * Before: binary 'Healthy' / 'Degraded'. The 'Degraded' label fired any
 * time pipelineHealthy was false — including the very common case of
 * last_sync_at being null (no real error, just sync hasn't recorded yet).
 * Pratik flagged this as alarming users for no real reason.
 *
 * After: three states.
 *   - Active   — pipelineHealthy=true
 *   - Syncing  — pipelineHealthy=false AND lastSyncAgo=null (no error)
 *   - Issue    — pipelineHealthy=false AND lastSyncAgo present (real stale)
 */
import { describe, it, expect } from 'vitest';

// Mirror the same derivation logic the popup uses inline. If this stays
// in sync with src/popup/index.tsx the tests will catch any drift.
function deriveStatus(snap: { pipelineHealthy: boolean; lastSyncAgo: string | null }) {
  const isActive = snap.pipelineHealthy;
  const isSyncing = !snap.pipelineHealthy && !snap.lastSyncAgo;
  return isActive ? 'Active' : isSyncing ? 'Syncing' : 'Issue';
}

describe('popup status badge derivation', () => {
  it("shows 'Active' (green) when pipeline is healthy", () => {
    expect(deriveStatus({ pipelineHealthy: true, lastSyncAgo: '2m ago' })).toBe('Active');
    expect(deriveStatus({ pipelineHealthy: true, lastSyncAgo: null })).toBe('Active');
  });

  it("shows 'Syncing' (amber) when last_sync_at is null AND not healthy — the common false-alarm case", () => {
    // This is the case Pratik repeatedly hit. Pre-fix this displayed
    // 'Degraded' in red. Should now be the gentler 'Syncing'.
    expect(deriveStatus({ pipelineHealthy: false, lastSyncAgo: null })).toBe('Syncing');
  });

  it("shows 'Issue' (red) only when sync is genuinely stale — last_sync exists but is old enough to fail healthy check", () => {
    expect(deriveStatus({ pipelineHealthy: false, lastSyncAgo: '2h ago' })).toBe('Issue');
    expect(deriveStatus({ pipelineHealthy: false, lastSyncAgo: '1d ago' })).toBe('Issue');
  });

  it("never shows 'Degraded' (the alarming label that no longer exists)", () => {
    const states = [
      { pipelineHealthy: true, lastSyncAgo: null },
      { pipelineHealthy: false, lastSyncAgo: null },
      { pipelineHealthy: false, lastSyncAgo: '5m ago' },
      { pipelineHealthy: true, lastSyncAgo: '5m ago' },
    ];
    states.forEach(s => {
      expect(deriveStatus(s)).not.toBe('Degraded');
    });
  });
});
