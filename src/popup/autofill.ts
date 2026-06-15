import browser from 'webextension-polyfill';
import type { ContentMessage, FillResponse } from '../messaging/content';

export interface ActiveTab {
  id: number;
  url: string;
  host: string; // hostname only (no port)
}

/** getActiveTab returns the focused tab, or null for tabs without a usable URL. */
export async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  try {
    return { id: tab.id, url: tab.url, host: new URL(tab.url).hostname };
  } catch {
    return null; // about:, chrome:, file: with no hostname, etc.
  }
}

/** fillActiveTab asks the content script in tabId to fill the credentials. */
export async function fillActiveTab(
  tabId: number,
  username: string,
  password: string,
): Promise<boolean> {
  const message: ContentMessage = { type: 'cowbird:fill', username, password };
  try {
    const res = (await browser.tabs.sendMessage(tabId, message)) as FillResponse | undefined;
    return Boolean(res?.filled);
  } catch {
    // No content script in this tab (e.g. page loaded before the extension, or a
    // restricted page). The caller surfaces a hint to reload.
    return false;
  }
}

/** hostMatches reports whether a stored item URL belongs to the given hostname,
 * allowing subdomain matches in either direction (login.example.com ⇄ example.com). */
export function hostMatches(itemUrl: string, host: string): boolean {
  let itemHost: string;
  try {
    itemHost = new URL(itemUrl.includes('://') ? itemUrl : `https://${itemUrl}`).hostname;
  } catch {
    return false;
  }
  if (!itemHost || !host) return false;
  return itemHost === host || host.endsWith(`.${itemHost}`) || itemHost.endsWith(`.${host}`);
}
