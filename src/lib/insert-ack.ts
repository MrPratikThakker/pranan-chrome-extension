/**
 * Side-panel insert acknowledgement (audit MEDIUM/LOW).
 *
 * The side panel used to fire chrome.tabs.sendMessage(tabId, msg) with no
 * callback, so it never learned whether the content script actually inserted
 * the draft. Content scripts already sendResponse({ success }). This helper
 * sends the message to the active tab and resolves a boolean from BOTH
 * chrome.runtime.lastError (channel/content-script gone) and the response
 * payload, so the panel can show Inserted / Could not insert (+ copy).
 */

export type InsertMessageType = 'INSERT_DRAFT' | 'INSERT_COMMENT_DRAFT';

export function sendInsertToActiveTab(
  type: InsertMessageType,
  text: string
): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        resolve(false);
        return;
      }
      chrome.tabs.sendMessage(
        tabId,
        { type, payload: { text } },
        (resp?: { success?: boolean }) => {
          // lastError must be read inside the callback or Chrome logs "Unchecked
          // runtime.lastError". A set lastError means the content script is gone.
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(!!resp?.success);
        }
      );
    });
  });
}
