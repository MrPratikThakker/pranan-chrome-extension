import { describe, it, expect, beforeEach } from 'vitest';
import { resolveLiveCompose, isOrphanedComposeBar } from '../src/lib/live-compose';

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

/**
 * Bars accumulating one per reply cycle.
 *
 * Measured in Pratik's "VC/Accelerator Discount Redemption Request" thread on
 * v0.8.41: TWO Pranan bars visible at once, and `[g_editable="true"]` count of
 * ZERO — two Generate buttons and not a single compose between them.
 *
 * The bar is injected as a SIBLING of the compose container, inside Gmail's
 * `.ip.iq` reply wrapper. When the user sends, Gmail tears down the compose but
 * keeps `.ip.iq` — so the bar survives with nothing to write into. Open a reply
 * again and Gmail builds a NEW `.ip.iq`, which the "don't inject twice" guard
 * (scoped to the container and its parent) cannot see. One more bar, every time.
 */
describe('isOrphanedComposeBar', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const wrapper = (withCompose: boolean) => {
    const ip = document.createElement('div');
    ip.className = 'ip iq';
    const bar = document.createElement('div');
    bar.setAttribute('data-pranan-bar', 'true');
    ip.appendChild(bar);
    if (withCompose) {
      const m9 = document.createElement('div');
      m9.className = 'M9';
      const body = document.createElement('div');
      body.setAttribute('contenteditable', 'true');
      body.setAttribute('g_editable', 'true');
      m9.appendChild(body);
      ip.appendChild(m9);
    }
    document.body.appendChild(ip);
    return { ip, bar };
  };

  it('leaves a bar alone while its compose is open', () => {
    const { bar } = wrapper(true);
    expect(isOrphanedComposeBar(bar, BODY)).toBe(false);
  });

  it('reports a bar whose compose was torn down (the send-then-reply case)', () => {
    const { ip, bar } = wrapper(true);
    ip.querySelector('.M9')!.remove();
    expect(isOrphanedComposeBar(bar, BODY)).toBe(true);
  });

  // The exact measured state: two wrappers, two bars, zero composes. Both bars
  // must be reported, or the thread keeps one dead Generate button forever.
  it('reports BOTH bars in the measured two-bar/zero-compose state', () => {
    const a = wrapper(false);
    const b = wrapper(false);
    expect(document.querySelectorAll('[data-pranan-bar]').length).toBe(2);
    expect(document.querySelectorAll(BODY).length).toBe(0);
    expect(isOrphanedComposeBar(a.bar, BODY)).toBe(true);
    expect(isOrphanedComposeBar(b.bar, BODY)).toBe(true);
  });

  // A live compose somewhere ELSE on the page must not keep a dead bar alive —
  // that is precisely how the second bar survived the first one's teardown.
  it('is not fooled by a live compose in a different wrapper', () => {
    const dead = wrapper(false);
    wrapper(true);
    expect(isOrphanedComposeBar(dead.bar, BODY)).toBe(true);
  });

  it('says nothing about a bar already removed from the page', () => {
    const { bar } = wrapper(true);
    bar.remove();
    expect(isOrphanedComposeBar(bar, BODY)).toBe(false);
  });
});
