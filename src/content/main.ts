import { GameController } from './controller';

const controller = new GameController();

/** How often to look for the table once the controller is up. */
const POLL_MS = 1000;

/**
 * Start the controller immediately, and look for the table separately.
 *
 * `controller.start()` is what registers the `chrome.runtime.onMessage`
 * listener, and it used to run only AFTER a `.table` element appeared. So on
 * any PokerNow page without a table the popup could not reach the content
 * script at all — every request came back as "the tab didn't answer", which
 * reads as the extension being broken while the tab is plainly open.
 *
 * I then made it worse by capping the search at 60 seconds: sit in a lobby
 * longer than that, or let PokerNow move you into a game without a full page
 * load, and the script gave up for good. The listener was never registered
 * and nothing said so.
 *
 * These are two different jobs. Being able to ANSWER the popup depends on
 * nothing but the script running. Only starting a pending SESSION needs a
 * table, so only that waits — and it waits indefinitely, because a table can
 * appear at any time.
 */
function init(): void {
  controller.start()
    .then(() => {
      console.log('[Poker Advisor] Ready');
      waitForTable();
    })
    .catch((err) => {
      // An unhandled rejection would leave the page with a half-started
      // controller and nothing in the console to say so
      console.error('[Poker Advisor] Failed to start', err);
    });
}

function waitForTable(): void {
  const check = (): void => {
    if (!document.querySelector('.table')) {
      setTimeout(check, POLL_MS);
      return;
    }
    console.log('[Poker Advisor] Table found — checking for pending session');
    checkPendingSession();
  };
  check();
}

function checkPendingSession(): void {
  chrome.storage.local.get('pendingSession', (result) => {
    if (result.pendingSession) {
      console.log('[Poker Advisor] Found pending session, starting...');
      // Start directly — do NOT echo through the service worker, which would
      // relay the message back to this tab and double-start the session
      void controller.startFromPending(result.pendingSession);
      chrome.storage.local.remove('pendingSession');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
