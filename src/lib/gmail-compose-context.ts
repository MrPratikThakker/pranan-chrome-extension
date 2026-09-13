import { extractSelfEmail, formatThreadContext } from './thread-context';

const MESSAGE_BODY = '.a3s.aiL, .ii.gt .a3s, [data-message-id] .a3s';

/** Never borrow the open reading thread for an independent compose dialog. */
export function composeThread(compose: Element): Element | null {
  if (compose.closest('[role="dialog"]') || compose.querySelector('input[name="subjectbox"]')) return null;
  let scope: Element | null = compose.parentElement;
  while (scope && scope !== document.body) {
    if (scope.querySelector(MESSAGE_BODY)) return scope;
    if (scope.matches('[role="main"]')) break;
    scope = scope.parentElement;
  }
  return null;
}

export function composeThreadMessages(compose: Element) {
  const thread = composeThread(compose);
  if (!thread) return [];
  return Array.from(thread.querySelectorAll<HTMLElement>(MESSAGE_BODY))
    .filter(body => !body.closest('[contenteditable="true"], [aria-hidden="true"]'))
    .slice(-6).map(body => {
      // .ii.gt contains the body but usually not its sender. Walk to the message.
      const host = body.closest('.adn, [data-message-id], [role="listitem"], .gs');
      const sender = host?.querySelector('.gD[email], .gD[data-hovercard-id]');
      return { sender: sender?.getAttribute('email') || sender?.getAttribute('data-hovercard-id') || null,
        name: sender?.getAttribute('name') || sender?.textContent?.trim() || null,
        text: (body.innerText || body.textContent || '').trim().slice(0, 1500) };
    });
}

export function scopedThreadContext(compose: Element): string | null {
  // Bound each body, preserving sender labels even on long threads.
  return formatThreadContext(composeThreadMessages(compose), extractSelfEmail(document.title));
}

export function replyTarget(compose: Element, recipients: string[]) {
  const self = extractSelfEmail(document.title);
  const audience = [...new Set(recipients.map(email => email.toLowerCase()))].filter(email => email !== self);
  const messages = composeThreadMessages(compose);
  const last = messages[messages.length - 1];
  // A removed recipient or our own last message must never override the To field.
  const email = last?.sender && audience.includes(last.sender.toLowerCase())
    ? last.sender : audience[0] || null;
  return { email, name: email && email.toLowerCase() === last?.sender?.toLowerCase() ? last.name : null };
}
