import { Card } from '../engine/types';
import { DB_NAME, DB_VERSION, STORE_HANDS, STORE_DECISIONS } from '../shared/constants';

/**
 * What an opponent did in a hand, recorded so losses can be explained
 * afterwards rather than guessed at.
 *
 * "He kept having stronger hands" and "I called big bets when I was behind"
 * are different problems with opposite fixes — one is variance, the other is
 * a leak. Telling them apart needs what they actually turned over and how
 * big their bets were, neither of which the history used to keep.
 *
 * Showdown cards are only ever captured for players the user has explicitly
 * chosen to track. Random opponents are never recorded.
 */
export interface VillainRecord {
  name: string;
  /** Cards they turned over, when they showed and we track them. */
  showed?: [Card, Card];
  /** Their net chips for the hand. */
  net: number;
  /** Their biggest bet, as a fraction of the pot it went into. */
  biggestBet?: { street: string; fraction: number };
}

export interface HandRecord {
  id?: number;
  timestamp: number;
  holeCards: [Card, Card];
  communityCards: Card[];
  result: 'win' | 'loss' | 'fold' | 'unknown';
  /**
   * Chips won on this hand. Positive for a win, ZERO for anything else —
   * kept as-is so old records still mean what they meant.
   */
  potWon: number;
  /**
   * Net chips for the hand, signed. Losses used to record potWon: 0, so the
   * history could say you lost a hand but never how much — which makes the
   * one question worth asking ("which hands are actually costing me?")
   * unanswerable. Optional because records written before this existed
   * genuinely don't know.
   */
  net?: number;
  /** Per-opponent detail, so a loss can be explained. */
  villains?: VillainRecord[];
  actions: string[];
  tableId: string;
  players: string[];
}

let dbInstance: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      // No profile store. This build keeps no record of any player, so
      // there is nowhere for one to be written even by mistake.
      if (!db.objectStoreNames.contains(STORE_HANDS)) {
        const store = db.createObjectStore(STORE_HANDS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('tableId', 'tableId');
      }
      if (!db.objectStoreNames.contains(STORE_DECISIONS)) {
        const store = db.createObjectStore(STORE_DECISIONS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('sessionId', 'sessionId');
        store.createIndex('timestamp', 'timestamp');
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;

      /**
       * Forget the handle if the connection goes away.
       *
       * The instance is cached for the life of the page, and a closed
       * connection throws InvalidStateError on every subsequent transaction.
       * All the callers wrap their work in `catch {}`, so that failure is
       * completely silent: profiles stop saving, hands stop recording, and
       * the extension carries on looking healthy.
       *
       * It closes for ordinary reasons — another tab opening the database at
       * a newer version, or the browser evicting storage. Clearing the cache
       * means the next call simply reopens instead.
       */
      dbInstance.onclose = () => { dbInstance = null; };
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });
}





export async function saveHand(hand: HandRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDS, 'readwrite');
    tx.objectStore(STORE_HANDS).add(hand);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHandCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDS, 'readonly');
    const req = tx.objectStore(STORE_HANDS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Wipe the learning decision log. Opponent profiles are left untouched. */
export async function clearDecisionLog(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DECISIONS, 'readwrite');
    tx.objectStore(STORE_DECISIONS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllHands(): Promise<HandRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDS, 'readonly');
    const req = tx.objectStore(STORE_HANDS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
