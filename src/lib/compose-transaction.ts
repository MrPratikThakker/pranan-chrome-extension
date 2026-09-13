/** A generated result may replace only the exact draft and audience it started with. */
export class ComposeTransactions {
  private pending = new Map<string, { editorId: string; html: string; context: string }>();
  private undo = new WeakMap<HTMLElement, { before: string; after: string }>();
  start(editorId: string, editor: HTMLElement, context: string): string {
    const id = crypto.randomUUID();
    this.pending.set(id, { editorId, html: editor.innerHTML, context });
    return id;
  }
  has(id: string) { return this.pending.has(id); }
  cancel(id: string) { this.pending.delete(id); }
  consume(id: string, editorId: string, editor: HTMLElement | null, context: string): boolean {
    const before = this.pending.get(id);
    this.pending.delete(id);
    return !!before && !!editor?.isConnected && before.editorId === editorId
      && before.html === editor.innerHTML && before.context === context;
  }
  remember(editor: HTMLElement, before: string) {
    this.undo.set(editor, { before, after: editor.innerHTML });
  }
  restore(editor: HTMLElement): boolean {
    const previous = this.undo.get(editor);
    if (!previous || editor.innerHTML !== previous.after) return false;
    // This HTML was captured from this same user's editor, never from the model.
    editor.innerHTML = previous.before;
    this.undo.delete(editor);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
}
