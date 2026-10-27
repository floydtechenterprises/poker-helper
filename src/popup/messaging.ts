import { Message } from '../shared/messages';

/**
 * Talking to the tab that's running the game.
 *
 * Lives apart from popup.ts so it can be tested without a DOM — the bug this
 * module exists to prevent is invisible from the outside and hangs the UI in
 * silence.
 */

/** The bits of the chrome API this needs, so a test can supply its own. */
export interface TabsApi {
  query(
    info: { url: string[] },
    cb: (tabs: { id?: number; url?: string }[]) => void,
  ): void;
  sendMessage(tabId: number, msg: Message, cb: (response: any) => void): void;
  /** chrome.runtime.lastError, read after each sendMessage. */
  lastError(): unknown;
}

/**
 * Where the game lives.
 *
 * The table is served from pvp.duel.com inside an iframe on duel.com, and
 * BOTH origins have to be listed, for different reasons.
 *
 * tabs.query matches the TAB's url, which is the outer page. Played the
 * normal way the tab is duel.com/arena/poker and a query for the inner
 * origin alone finds nothing at all — the popup reports no game and the
 * session can never start. Opening the frame on its own makes the tab
 * pvp.duel.com, which is how it was first tested and exactly why this did
 * not show up then.
 *
 * Sending still reaches the right place: tabs.sendMessage without a frameId
 * goes to every frame in the tab, and only the frame running the content
 * script answers. So the outer origin is how the tab is FOUND and the inner
 * one is where the listener actually lives.
 */
export const GAME_URLS = ['*://pvp.duel.com/*', '*://*.duel.com/*'];

/**
 * Send a message to the tab running the session's game.
 *
 * Prefers tabs whose URL matches the stored game link, then falls through the
 * rest until one answers, so several open poker tabs can't hijack the
 * popup.
 *
 * The callback ALWAYS runs — with `undefined` when nothing could be reached.
 * Both give-up paths used to `return` without calling it, so any caller that
 * only rendered on success sat forever on its loading state: the
 * "Why am I losing to them?" button hung on "Reading your hand history…"
 * with no error at all, because the failure branch it had was never reached.
 * A callback that sometimes never fires is worse than an error, since there
 * is nothing for the caller to handle.
 */
export function sendToGameTab(
  tabs: TabsApi,
  msg: Message,
  cb?: (response: any) => void,
): void {
  let settled = false;
  const done = (response: any) => {
    if (settled) return; // never resolve twice, whatever the API does
    settled = true;
    cb?.(response);
  };

  tabs.query({ url: GAME_URLS }, (found) => {
    if (!found || found.length === 0) { done(undefined); return; }

    /*
     * Tabs used to be ordered by how well their url matched the game link,
     * so several open PokerNow games could not hijack each other. There is
     * no link here and the origin is the whole identity, so every matching
     * tab is tried in turn and the first that answers wins.
     */
    const ordered = found;

    const tryNext = (i: number): void => {
      if (i >= ordered.length) { done(undefined); return; }
      const id = ordered[i].id;
      if (id === undefined) { tryNext(i + 1); return; }
      tabs.sendMessage(id, msg, (response) => {
        if (tabs.lastError() || response === undefined) { tryNext(i + 1); return; }
        done(response);
      });
    };
    tryNext(0);
  });
}
