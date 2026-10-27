import { getAllHands } from './db';
import { cardToString } from '../engine/cards';

export async function exportHandHistory(): Promise<string> {
  const hands = await getAllHands();

  const formatted = hands.map(h => ({
    timestamp: new Date(h.timestamp).toISOString(),
    holeCards: h.holeCards.map(cardToString),
    communityCards: h.communityCards.map(cardToString),
    result: h.result,
    potWon: h.potWon,
    // Signed net, so losses are visible with their size
    net: h.net ?? (h.result === 'win' ? h.potWon : null),
    players: h.players,
    // What each opponent did, and what they showed if they showed
    villains: h.villains,
    tableId: h.tableId,
  }));

  return JSON.stringify(formatted, null, 2);
}

/**
 * Save a string to the user's Downloads folder.
 *
 * MUST be called from an extension page (the popup), never from the content
 * script. A content script's DOM belongs to PokerNow, so the blob: navigation
 * this performs is subject to PokerNow's Content-Security-Policy — which
 * silently blocks it. Clicking Export did nothing at all, with no error
 * anywhere, because the click was refused by a policy we don't control.
 *
 * The anchor is appended before clicking and the URL is revoked on a timer
 * rather than synchronously: revoking in the same tick can cancel the
 * download before the browser has read the blob, which is the same failure
 * wearing a different hat.
 */
export function downloadJson(data: string, filename: string): void {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 30_000);
}
