import { describe, it, expect, beforeEach } from 'vitest';
import { resolveLiveCompose } from '../src/lib/live-compose';

// The real chains, so the test breaks if the registry changes underneath it.
const BODY = '.Am.aiL [contenteditable="true"], [contenteditable="true"][aria-label="Message Body"], [contenteditable="true"][g_editable="true"]';
const CONTAINER = '.AD, .M9, .nH.oy8Mbf, [role="dialog"], .ip.iq, .aO7';

/**
 * Gmail's inline reply, reduced to the parts that matter. Measured live on
 * Pratik's inbox 29 Jul 2026: the bar is injected into the THREAD container
 * (`.ip.adB`), a sibling-of-sorts to the compose (`.aO7`) rather than an
 * ancestor of it — which is exactly why the bar outlives the compose.
 */
function buildThread(): { thread: HTMLElement; bar: HTMLElement; compose: HTMLElement } {
  document.body.innerHTML = '';
  const thread = document.createElement('div');
  thread.className = 'ip adB';

  const bar = document.createElement('div');
  bar.setAttribute('data-pranan-bar', '1');
  thread.appendChild(bar);

  const compose = makeCompose();
  thread.appendChild(compose);

  document.body.appendChild(thread);
  return { thread, bar, compose };
}

function makeCompose(): HTMLElement {
  const compose = document.createElement('div');
  compose.className = 'aO7';
  const am = document.createElement('div');
  am.className = 'Am aiL';
  const body = document.createElement('div');
  body.setAttribute('contenteditable', 'true');
  body.setAttribute('g_editable', 'true');
  am.appendChild(body);
  compose.appendChild(am);
  return compose;
}

describe('resolveLiveCompose', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('keeps the captured compose while it is still live', () => {
    const { bar, compose } = buildThread();
    expect(resolveLiveCompose(bar, compose, BODY, CONTAINER)).toBe(compose);
  });

  // The measured bug. Gmail (or HubSpot Sales, which rebuilds the compose body)
  // swaps the compose subtree; the bar survives because it lives in the thread
  // container. Every read through the captured reference then silently returns
  // nothing: no alignment, no thread context, and stampEditor marks a node that
  // is no longer in the document.
  it('re-resolves after Gmail replaces the compose subtree', () => {
    const { thread, bar, compose } = buildThread();
    const replacement = makeCompose();
    thread.replaceChild(replacement, compose);

    expect(compose.isConnected).toBe(false);
    expect(resolveLiveCompose(bar, compose, BODY, CONTAINER)).toBe(replacement);
  });

  // Subtler variant: the container element survives but Gmail rebuilds the
  // editable inside it, so the captured node is connected yet no longer holds a
  // compose body. Reading through it looks like "no compose" to every caller.
  it('re-resolves when the captured compose is connected but has lost its body', () => {
    const { thread, bar, compose } = buildThread();
    compose.innerHTML = '';
    const replacement = makeCompose();
    thread.appendChild(replacement);

    expect(compose.isConnected).toBe(true);
    expect(resolveLiveCompose(bar, compose, BODY, CONTAINER)).toBe(replacement);
  });

  // The safety property the editor-binding audit bought us: a draft must land
  // in the compose it was requested from, or nowhere. Two open composes in the
  // bar's container is ambiguous, so we refuse rather than pick one.
  it('refuses to guess when the bar container holds two composes', () => {
    const { thread, bar, compose } = buildThread();
    compose.remove();
    thread.appendChild(makeCompose());
    thread.appendChild(makeCompose());

    // Two live composes now, neither of them the captured one.
    expect(thread.querySelectorAll(BODY).length).toBe(2);
    expect(resolveLiveCompose(bar, compose, BODY, CONTAINER)).toBeNull();
  });

  it('returns null when the compose is gone entirely (reply discarded)', () => {
    const { bar, compose } = buildThread();
    compose.remove();
    expect(resolveLiveCompose(bar, compose, BODY, CONTAINER)).toBeNull();
  });

  it('returns null when the bar itself is detached', () => {
    const { thread, bar, compose } = buildThread();
    thread.remove();
    expect(resolveLiveCompose(bar, compose, BODY, CONTAINER)).toBeNull();
  });

  it('survives a null captured reference', () => {
    const { bar, compose } = buildThread();
    expect(resolveLiveCompose(bar, null, BODY, CONTAINER)).toBe(compose);
  });

  // A body with no registered container ancestor still has to resolve to
  // something usable, or a Gmail layout change silently disables the bar.
  it('falls back to the body container when no registered wrapper matches', () => {
    document.body.innerHTML = '';
    const thread = document.createElement('div');
    thread.className = 'ip adB';
    const bar = document.createElement('div');
    thread.appendChild(bar);
    const loose = document.createElement('div');
    loose.className = 'unknown-gmail-layout';
    const body = document.createElement('div');
    body.setAttribute('contenteditable', 'true');
    body.setAttribute('g_editable', 'true');
    loose.appendChild(body);
    thread.appendChild(loose);
    document.body.appendChild(thread);

    const resolved = resolveLiveCompose(bar, null, BODY, CONTAINER);
    expect(resolved).not.toBeNull();
    expect(resolved!.contains(body)).toBe(true);
  });
});
