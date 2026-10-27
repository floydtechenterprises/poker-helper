import { Message } from '../shared/messages';

const GAME_URLS = ['*://*.pokernow.club/*', '*://*.pokernow.com/*'];

/**
 * Broadcast settings changes to every open game tab.
 *
 * This is the ONLY thing that needs a background script. The popup talks to
 * the content script directly through `chrome.tabs.sendMessage` for
 * everything else, because it needs to choose WHICH tab — the one running the
 * session — and a broadcast cannot do that.
 *
 * A relay for START_SESSION, STOP_SESSION and GET_SESSION_STATE used to live
 * here and had no callers at all. Worth being specific about why it is gone
 * rather than left harmlessly in place:
 *
 *   - It answered from whichever tab replied first, so with two PokerNow
 *     tabs open the popup could be talking to the wrong game.
 *   - `main.ts` explicitly avoids this path, with a comment saying an echo
 *     through the service worker relays the message back to the same tab and
 *     double-starts the session.
 *   - It returned `true` for an async response and then never called
 *     `sendResponse` if no tab answered, so the caller's callback simply
 *     never ran — the same hang that was already fixed once in the popup's
 *     own sender.
 *
 * Dead code that would misbehave if revived is worse than no code, because
 * the next person to need a relay writes one from scratch rather than
 * inheriting three bugs.
 */

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  /**
   * Fetch the session log on the content script's behalf (FETCH_JSON).
   *
   * The content script fetches it directly first. This is the fallback for
   * when the page's own content-security policy blocks that request: the
   * worker is not subject to it, and carries the extension's host
   * permissions, so the player's PokerNow cookie goes with the request.
   */
  /*
   * A FETCH_JSON relay was here: it fetched PokerNow's session log on the
   * content script's behalf, for pages whose content-security policy
   * blocked the direct request. The log existed to build opponent
   * observations and went with the profiling, so nothing has sent this
   * message since.
   */

  if (msg.type === 'SETTINGS_UPDATED') {
    chrome.tabs.query({ url: GAME_URLS }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        // Fire and forget: a tab without a content script (still loading, or
        // a lobby page) rejects this, and that is not an error worth raising
        chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
      }
    });
  }

  // Nothing here answers synchronously or asynchronously
  return false;
});
