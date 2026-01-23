import type { ExtensionMessage, MessageType } from '../types/messages';

// Send message to background service worker
export async function sendToBackground<T = unknown>(
  message: ExtensionMessage
): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

// Send message to content script in active tab
export async function sendToActiveTab<T = unknown>(
  message: ExtensionMessage
): Promise<T | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    return chrome.tabs.sendMessage(tab.id, message);
  }
  return undefined;
}

// Send message to specific tab
export async function sendToTab<T = unknown>(
  tabId: number,
  message: ExtensionMessage
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

// Message listener helper
export function onMessage(
  callback: (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => boolean | void | Promise<unknown>
): () => void {
  chrome.runtime.onMessage.addListener(callback);
  return () => chrome.runtime.onMessage.removeListener(callback);
}

// Type-safe message handler
export function createMessageHandler<T extends MessageType>(
  type: T,
  handler: (
    payload: Extract<ExtensionMessage, { type: T }>['payload'],
    sender: chrome.runtime.MessageSender
  ) => Promise<unknown> | unknown
) {
  return (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean => {
    if (message.type === type) {
      const result = handler(message.payload as Extract<ExtensionMessage, { type: T }>['payload'], sender);
      if (result instanceof Promise) {
        result.then(sendResponse);
        return true; // Keep the message channel open for async response
      }
      sendResponse(result);
    }
    return false;
  };
}




