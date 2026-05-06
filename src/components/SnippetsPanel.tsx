/**
 * Snippets Panel
 *
 * Lists the user's personal + org snippets with search + insert.
 * Used from the side panel as a "Templates" view that can drop
 * a saved chunk of text into the active compose window on
 * Gmail / Slack / LinkedIn.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { getSnippets, type Snippet } from '@/lib/api-client';

interface Props {
  onBack: () => void;
  onInsert: (text: string) => void;
}

export function SnippetsPanel({ onBack, onInsert }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSnippets()
      .then((rows) => {
        if (cancelled) return;
        setSnippets(rows);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load snippets');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter((s) => {
      const hay = `${s.name} ${s.title || ''} ${s.body} ${(s.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [snippets, query]);

  const personal = filtered.filter((s) => s.scope === 'personal');
  const team = filtered.filter((s) => s.scope === 'org');

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-[11px] text-brand-text-3 hover:text-brand-text flex items-center gap-1.5"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <span className="text-[10px] text-brand-text-3 font-mono">
          {snippets.length} total
        </span>
      </div>

      <h2 className="text-base font-light font-display text-brand-text tracking-[-0.04em]">
        Snippets
      </h2>

      {/* Search */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search snippets, tags, or text..."
        className="w-full px-3 py-2 text-[12px] bg-brand-surface-2 border border-brand-border rounded-md text-brand-text placeholder:text-brand-text-3/50 focus:outline-none focus:border-brand-accent/40"
      />

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="text-[11px] text-brand-red bg-brand-red/8 border border-brand-red/15 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && snippets.length === 0 && (
        <div className="text-center py-12 px-4">
          <p className="text-[12px] text-brand-text-3 mb-3">
            No snippets yet.
          </p>
          <p className="text-[11px] text-brand-text-3/60 leading-relaxed">
            Create your first snippet in <span className="text-brand-accent">Settings &rarr; Snippets</span> on the web app, then come back here to insert it.
          </p>
        </div>
      )}

      {/* No matches */}
      {!isLoading && !error && snippets.length > 0 && filtered.length === 0 && (
        <p className="text-[11px] text-brand-text-3 text-center py-6">
          No snippets match {'"'}{query}{'"'}.
        </p>
      )}

      {/* Personal */}
      {!isLoading && personal.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="section-label" style={{ fontSize: '9px' }}>Personal</h3>
          {personal.map((s) => (
            <SnippetRow key={s.id} snippet={s} onInsert={onInsert} />
          ))}
        </div>
      )}

      {/* Team */}
      {!isLoading && team.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="section-label" style={{ fontSize: '9px' }}>Team</h3>
          {team.map((s) => (
            <SnippetRow key={s.id} snippet={s} onInsert={onInsert} />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  snippet: Snippet;
  onInsert: (text: string) => void;
}

function SnippetRow({ snippet, onInsert }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = snippet.body.length > 110 ? snippet.body.slice(0, 110).trim() + '...' : snippet.body;

  return (
    <div className="glass-card p-2.5 hover:border-brand-accent/25 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-mono text-brand-accent">/{snippet.name}</span>
            {snippet.use_count > 0 && (
              <span className="text-[9px] text-brand-text-3 font-mono tabular-nums">
                used {snippet.use_count}x
              </span>
            )}
          </div>
          {snippet.title && (
            <p className="text-[11px] text-brand-text font-medium truncate">{snippet.title}</p>
          )}
        </div>
        <button
          onClick={() => onInsert(snippet.body)}
          className="btn-accent text-[10px] py-1 px-2.5 flex-shrink-0"
          title="Insert into compose"
        >
          Insert
        </button>
      </div>

      <p
        className="text-[11px] text-brand-text-3 leading-relaxed cursor-pointer whitespace-pre-wrap"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        {expanded ? snippet.body : preview}
      </p>

      {(snippet.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {snippet.tags.map((t) => (
            <span
              key={t}
              className="text-[9px] text-brand-text-3 bg-brand-surface-2 border border-brand-border rounded-sm px-1.5 py-0.5"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
