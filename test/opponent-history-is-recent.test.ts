/**
 * L8: an opponent's history describes how he plays now.
 *
 * computeStats keeps the most recent 300 decisions — recent for the pooled
 * history, but against someone met occasionally, 300 decisions reach back
 * months, and those came back at full weight as today's read on him. The
 * per-opponent slice now covers the last OPPONENT_HISTORY_DAYS.
 */
import { LearningEngine, DecisionRecord, OPPONENT_HISTORY_DAYS, FULL_OPPONENT_WEIGHT } from '../src/engine/learning';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const DAY = 24 * 60 * 60 * 1000;
function decision(ageDays: number, i: number): DecisionRecord {
  return {
    timestamp: Date.now() - ageDays * DAY + i, sessionId: 's', street: 'flop',
    holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] as any, communityCards: [],
    recommended: 'bet', confidence: 50, equity: 50, potSize: 100, stackSize: 1000,
    outcome: 'win', profitLoss: 10, activePlayers: 2, position: 'SB',
    boardWetness: 2, wasBluff: false, opponent: 'noob',
  };
}
const fakeDb = (records: DecisionRecord[]) => ({
  transaction: () => ({ objectStore: () => ({ getAll: () => {
    const req: any = {}; setTimeout(() => { req.result = records; req.onsuccess?.(); }); return req;
  } }) }),
}) as unknown as IDBDatabase;

(async () => {
  console.log('\na heavy history from long ago, nothing recent');
  {
    const old = Array.from({ length: FULL_OPPONENT_WEIGHT * 2 }, (_, i) => decision(OPPONENT_HISTORY_DAYS + 30, i));
    const e = new LearningEngine();
    await e.loadStats(fakeDb(old), 'noob');
    check('it carries no opponent weight', e.opponentWeight() === 0, `weight ${e.opponentWeight()}`);
  }

  console.log('\nthe same volume played this week');
  {
    const recent = Array.from({ length: FULL_OPPONENT_WEIGHT * 2 }, (_, i) => decision(2, i));
    const e = new LearningEngine();
    await e.loadStats(fakeDb(recent), 'noob');
    check('it carries full weight', e.opponentWeight() === 1, `weight ${e.opponentWeight()}`);
  }

  console.log(failures > 0 ? `\n${failures} recency test(s) failed` : '\nall recency tests passed');
  process.exit(failures > 0 ? 1 : 0);
})();
