/**
 * The decision log records a decision once, not once per re-evaluation.
 *
 * The advisor re-evaluates on every DOM tick and wrote a record each time,
 * so the log counted ticks rather than decisions. Measured on the backup of
 * 21 October: 20873 rows were 1822 distinct decisions across 410 hands, an
 * 11.5x inflation. One hand that sat for 450 seconds wrote 2666 rows — one
 * pair of hole cards, one unchanged board, the same advice, logged over and
 * over at roughly 150ms.
 *
 * That is not merely a storage problem. `computeStats` takes `.slice(-300)`
 * of the rows BEFORE grouping them into hands, so the window meant to hold
 * recent play holds the last 300 ROWS. In that backup those 300 rows span
 * FOUR distinct hands, and three individual hands are each long enough to
 * fill the window on their own. The learning engine was adapting to almost
 * nothing, and nothing anywhere reported it — the log looked full.
 *
 * The fix is at the write: an unchanged decision is not a new decision.
 * The read side is left alone deliberately. Once the writes are clean, 300
 * rows is the ~70 hands it was always meant to be, and changing what the
 * learning window contains is a strategy change that belongs behind its own
 * measurement.
 *
 * What counts as the same decision: the same hand, street, board, hole
 * cards, action, amount and pot. Equity and confidence are excluded on
 * purpose — equity comes from Monte Carlo and drifts by a fraction of a
 * percent between runs on identical input, so keying on it would defeat the
 * whole thing.
 */
import { installFakeIndexedDB } from './helpers/fake-indexeddb';
import { LearningEngine, DecisionRecord } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `  (${detail})`}`);
  if (!cond) failures++;
}

const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    timestamp: Date.now(),
    sessionId: 's1',
    street: 'flop',
    holeCards: [c(14, 0), c(13, 0)],
    communityCards: [c(11, 3), c(9, 0), c(5, 0)],
    recommended: 'check',
    confidence: 70,
    equity: 55,
    potSize: 400,
    stackSize: 10000,
    outcome: 'unknown',
    opponent: 'noob',
    profitLoss: 0,
    activePlayers: 2,
    position: 'BB',
    boardWetness: 4,
    wasBluff: false,
    bigBlind: 80,
    handStart: 1000,
    ...over,
  } as DecisionRecord;
}

async function main(): Promise<void> {
  const db = installFakeIndexedDB();
  const store = () => db.stores.get('decision-log');
  const rows = () => store()?.rows.size ?? 0;

  // The fake needs the store the engine writes into.
  db.createObjectStore('decision-log', { keyPath: 'id', autoIncrement: true });

  const idb = (globalThis as any).indexedDB;
  const open = (): Promise<IDBDatabase> => new Promise(res => {
    const req = idb.open('x', 1);
    req.onsuccess = () => res(req.result);
  });
  const handle = await open();

  console.log('\nthe same decision, re-evaluated 200 times');
  {
    const engine = new LearningEngine();
    for (let i = 0; i < 200; i++) {
      // What actually varies between ticks: the clock, and Monte Carlo
      // equity wobbling by a fraction of a percent on identical input.
      await engine.recordDecision(handle, decision({
        timestamp: 1_000_000 + i * 150,
        equity: 55 + Math.sin(i) * 0.4,
        confidence: 70,
      }));
    }
    check('it is recorded once', rows() === 1, `${rows()} rows`);
  }

  console.log('\nbut anything that makes it a different decision is recorded');
  {
    const before = rows();
    const engine2 = new LearningEngine();
    // A genuinely new spot in the same hand: the turn arrives.
    await engine2.recordDecision(handle, decision({
      street: 'turn',
      communityCards: [c(11, 3), c(9, 0), c(5, 0), c(7, 2)],
    }));
    check('a new street is a new decision', rows() === before + 1, `${rows()} rows`);

    await engine2.recordDecision(handle, decision({ recommended: 'raise' }));
    check('a different action is a new decision', rows() === before + 2, `${rows()} rows`);

    await engine2.recordDecision(handle, decision({ recommended: 'raise', recommendedAmount: 900 }));
    check('a different amount is a new decision', rows() === before + 3, `${rows()} rows`);

    await engine2.recordDecision(handle, decision({ potSize: 1200 }));
    check('the opponent betting is a new decision', rows() === before + 4, `${rows()} rows`);

    await engine2.recordDecision(handle, decision({ handStart: 2000 }));
    check('the next hand is a new decision', rows() === before + 5, `${rows()} rows`);

    await engine2.recordDecision(handle, decision({
      handStart: 2000, holeCards: [c(2, 1), c(7, 2)],
    }));
    check('different hole cards are a new decision', rows() === before + 6, `${rows()} rows`);
  }

  console.log('\na hand of real play records every spot in it');
  {
    store()?.rows.clear();
    const engine = new LearningEngine();
    const spots: Partial<DecisionRecord>[] = [
      { street: 'preflop', communityCards: [], recommended: 'raise', potSize: 120 },
      { street: 'flop', recommended: 'check', potSize: 400 },
      { street: 'flop', recommended: 'call', potSize: 900 },
      { street: 'turn', communityCards: [c(11, 3), c(9, 0), c(5, 0), c(7, 2)], recommended: 'check', potSize: 900 },
      { street: 'river', communityCards: [c(11, 3), c(9, 0), c(5, 0), c(7, 2), c(2, 1)], recommended: 'fold', potSize: 2400 },
    ];
    // Each spot sat on screen for a while, as they do.
    for (const s of spots) {
      for (let i = 0; i < 40; i++) {
        await engine.recordDecision(handle, decision({ ...s, timestamp: 2_000_000 + i }));
      }
    }
    check('five spots, 200 evaluations, five rows', rows() === 5, `${rows()} rows`);
  }

  console.log('\nand the 2666-row hand from the backup collapses');
  {
    store()?.rows.clear();
    const engine = new LearningEngine();
    // Verified from the data: one pair of hole cards, one board, one
    // action, for 450 seconds.
    for (let i = 0; i < 2666; i++) {
      await engine.recordDecision(handle, decision({
        street: 'preflop', communityCards: [], recommended: 'check',
        potSize: 120, timestamp: 3_000_000 + i * 150, equity: 35,
      }));
    }
    check('2666 evaluations become one decision', rows() === 1, `${rows()} rows`);
  }

  if (failures > 0) {
    console.error(`\n${failures} decision-log test(s) failed`);
    process.exit(1);
  }
  console.log('\nall decision-log tests passed');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
