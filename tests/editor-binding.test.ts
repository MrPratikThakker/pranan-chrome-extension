/**
 * Editor binding (audit HIGH): a generated draft must only insert into the
 * editor it was requested from. If that editor is gone (the user switched
 * compose/tab/post mid-flight), resolveEditor must return null so the content
 * script returns a non-insert result (reason:'editor_changed') instead of
 * falling back to whatever editor is currently active.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { stampEditor, resolveEditor, EDITOR_ID_ATTR } from '../src/content/shared/editor-binding';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('editor binding correlation token', () => {
  it('stamps an element with a stable id and resolves back to it', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const id = stampEditor(el);
    expect(id).toBeTruthy();
    expect(el.getAttribute(EDITOR_ID_ATTR)).toBe(id);
    expect(resolveEditor(id)).toBe(el);
  });

  it('reuses an existing id on repeated stamps (idempotent)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const id1 = stampEditor(el);
    const id2 = stampEditor(el);
    expect(id1).toBe(id2);
  });

  it('returns DISTINCT ids for distinct editors', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const idA = stampEditor(a);
    const idB = stampEditor(b);
    expect(idA).not.toBe(idB);
    expect(resolveEditor(idA)).toBe(a);
    expect(resolveEditor(idB)).toBe(b);
  });

  it('resolves to null when the originating editor is removed (editor_changed)', () => {
    const original = document.createElement('div');
    document.body.appendChild(original);
    const id = stampEditor(original);

    // User switches compose: the original editor is gone, a different one is now active.
    original.remove();
    const other = document.createElement('div');
    document.body.appendChild(other);
    stampEditor(other);

    // The bound id must NOT resolve to the new editor. It resolves to nothing,
    // which is what makes the content script return editor_changed rather than
    // inserting into the wrong place.
    expect(resolveEditor(id)).toBeNull();
  });

  it('returns null for a missing / empty editor id (backward-compat callers)', () => {
    expect(resolveEditor(null)).toBeNull();
    expect(resolveEditor(undefined)).toBeNull();
    expect(resolveEditor('')).toBeNull();
    expect(resolveEditor('never-stamped')).toBeNull();
  });

  it('stampEditor is a no-op (null) for a missing element', () => {
    expect(stampEditor(null)).toBeNull();
    expect(stampEditor(undefined)).toBeNull();
  });

  it('recovers after the editor is re-rendered inside the same compose (HubSpot Sales)', () => {
    const form = document.createElement('form');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('role', 'textbox');
    form.appendChild(editable);
    document.body.appendChild(form);

    const id = stampEditor(editable);
    expect(resolveEditor(id)).toBe(editable);

    // HubSpot/Gmail rebuilds the compose body: old editable replaced by a fresh
    // element with no correlation id; the form container survives.
    editable.remove();
    const fresh = document.createElement('div');
    fresh.setAttribute('contenteditable', 'true');
    fresh.setAttribute('role', 'textbox');
    form.appendChild(fresh);

    const resolved = resolveEditor(id);
    expect(resolved).toBe(fresh);
    expect(fresh.getAttribute(EDITOR_ID_ATTR)).toBe(id); // re-stamped
  });

  it('does NOT recover across a genuinely different compose (host also gone)', () => {
    const form1 = document.createElement('form');
    const e1 = document.createElement('div');
    e1.setAttribute('contenteditable', 'true');
    form1.appendChild(e1);
    document.body.appendChild(form1);
    const id = stampEditor(e1);

    // The whole compose (editor + host) is gone; a separate compose appears.
    form1.remove();
    const form2 = document.createElement('form');
    const e2 = document.createElement('div');
    e2.setAttribute('contenteditable', 'true');
    form2.appendChild(e2);
    document.body.appendChild(form2);

    expect(resolveEditor(id)).toBeNull();
  });
});
