/** Await actual insertion, restricted to the originating tab and editor. */
export type InsertMessageType = 'INSERT_DRAFT' | 'INSERT_COMMENT_DRAFT';

export function sendInsertToActiveTab(
  type: InsertMessageType,
  text: string,
  target?: { sourceTabId?: number; editorId?: string | null },
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => finish(false), 5000);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (settled) return;
        const tabId = tabs[0]?.id;
        if (chrome.runtime.lastError || !tabId ||
          (target?.sourceTabId !== undefined && target.sourceTabId !== tabId)) {
          finish(false);
          return;
        }
        try {
          chrome.tabs.sendMessage(tabId, {
            type,
            payload: { text, ...(target?.editorId ? { editorId: target.editorId } : {}) },
          }, (resp?: { success?: boolean }) => {
            const failed = !!chrome.runtime.lastError;
            finish(!failed && !!resp?.success);
          });
        } catch { finish(false); }
      });
    } catch { finish(false); }
  });
}
