/**
 * What we learn against one player must not govern how we play the next.
 *
 * The learning layer pooled every decision ever made, with no idea who it was
 * made against. Heads-up that is not a small imprecision — it is a leak
 * manufactured out of somebody else's tendencies. "River bluffs are getting
 * called" learned against a calling station is exactly backwards against a
 * rock, and the pooled figure applied it to the rock anyway.
 *
 * Across the week that prompted this there were nine different heads-up
 * opponents, none of whom played alike. The pooled number described nobody at
 * the table.
 *
 * The reads (`profile`, `counter-exploit`) were already per-opponent. This is
 * the last layer that was not.
 */
import {
  LearningEngine, DecisionRecord, MIN_DECISIONS, FULL_OPPONENT_WEIGHT,
} from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
function near(name: string, actual: number, expected: number, tol = 1e-6): void {
  check(name, Math.abs(actual - expected) <= tol,
    `got ${actual}, expected ${expected}`);
}

const CARD: Card = { rank: 14 as any, suit: 0 as any };

let seq = 0;
// Recent: an opponent's history now only reaches back OPPONENT_HISTORY_DAYS,
// and a timestamp counted up from zero is 1970
const START = Date.now() - 60 * 60 * 1000;
/** A resolved bluff, attributed to an opponent (or to nobody). */
function bluff(won: boolean, opponent?: string): DecisionRecord {
  seq++;
  return {
    timestamp: START + seq,
    sessionId: 's',
    street: 'flop',
    holeCards: [CARD, CARD],
    communityCards: [],
    recommended: 'bet',
    confidence: 50,
    equity: 0.4,
    potSize: 100,
    stackSize: 1000,
    outcome: won ? 'win' : 'loss',
    opponent,
    profitLoss: won ? 50 : -50,
    activePlayers: 2,
    position: 'BB',
    boardWetness: 0.3,
    wasBluff: true,
    handStart: seq, // each bluff is its own hand
  };
}

/** An in-memory stand-in for the IndexedDB the engine reads from. */
function fakeDb(records: DecisionRecord[]): any {
  return {
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          const req: any = {};
          setTimeout(() => { req.result = records; req.onsuccess?.(); }, 0);
          return req;
        },
      }),
    }),
  };
}

async function main(): Promise<void> {
  /**
   * Two opponents, opposite lessons.
   *
   * Against `station` our bluffs fail (2 of 30) — the engine should tighten.
   * Against `rock` they work (28 of 30) — it should press. Pooled, the two
   * cancel to exactly 50% and the engine concludes nothing, which is the
   * failure in one number: a real, actionable, opposite read against each of
   * two players, averaged into silence.
   */
  const records: DecisionRecord[] = [];
  for (let i = 0; i < 30; i++) records.push(bluff(i < 2, 'station'));
  for (let i = 0; i < 30; i++) records.push(bluff(i >= 2, 'rock'));

  console.log('the pooled history alone cannot see either read');
  {
    const e = new LearningEngine();
    await e.loadStats(fakeDb(records));
    near('pooled bluff scale is neutral', e.getLearnedParams().bluffScale, 1);
    check('and it names no opponent', e.getSnapshot().vsOpponent === null);
  }

  console.log('each opponent gets their own conclusion');
  {
    const vsStation = new LearningEngine();
    await vsStation.loadStats(fakeDb(records), 'station');
    const vsRock = new LearningEngine();
    await vsRock.loadStats(fakeDb(records), 'rock');

    const s = vsStation.getLearnedParams().bluffScale;
    const r = vsRock.getLearnedParams().bluffScale;
    check('bluffing is dialled DOWN against the one who calls', s < 1, `got ${s}`);
    check('and UP against the one who folds', r > 1, `got ${r}`);
    check('so the two are not the same strategy', s !== r);
  }

  console.log('the reasoning says whose behaviour it is describing');
  {
    // Enough decisions that his history carries most of the blend
    const heavy = [...records, ...Array.from({ length: 20 }, () => bluff(false, 'station'))];
    const e = new LearningEngine();
    await e.loadStats(fakeDb(heavy), 'station');
    const adj = e.getAdjustments();
    check('adjustments are attributed',
      adj.length > 0 && adj.every(a => a.description.startsWith('vs station:')),
      adj.map(a => a.description).join(' | '));

    /**
     * L12: the panel reports the history that is steering. At 30 decisions
     * his read carries 20% of the blended thresholds, so reporting his
     * adjustments alone described advice the engine was not giving.
     */
    const light = new LearningEngine();
    await light.loadStats(fakeDb(records), 'station');
    check('below half weight the pooled read is reported',
      light.opponentWeight() < 0.5
        && light.getAdjustments().every(a => !a.description.startsWith('vs station:')),
      `weight ${light.opponentWeight()}: ${light.getAdjustments().map(a => a.description).join(' | ')}`);
  }

  console.log('a thin sample falls back to the pooled history');
  {
    /**
     * The regression that matters most: with too few hands against someone,
     * their slice is noise. Acting on it would be worse than the pooled
     * behaviour this replaces, so below the floor nothing changes at all.
     */
    const thin = [...records, ...Array.from({ length: MIN_DECISIONS - 1 },
      () => bluff(false, 'stranger'))];
    const e = new LearningEngine();
    await e.loadStats(fakeDb(thin), 'stranger');
    near('a stranger does not move the parameters', e.getLearnedParams().bluffScale, 1);
    check('and the weight is zero', e.opponentWeight() === 0);
    check('but the snapshot still shows the progress toward a read',
      (e.getSnapshot().vsOpponent?.decisions ?? 0) === MIN_DECISIONS - 1);
  }

  console.log('the handover is gradual, not a cliff');
  {
    const weightAt = async (n: number) => {
      const set = [...records, ...Array.from({ length: n }, () => bluff(false, 'newcomer'))];
      const e = new LearningEngine();
      await e.loadStats(fakeDb(set), 'newcomer');
      return e.opponentWeight();
    };
    const atFloor = await weightAt(MIN_DECISIONS);
    const atFull = await weightAt(FULL_OPPONENT_WEIGHT);
    const beyond = await weightAt(FULL_OPPONENT_WEIGHT * 3);

    // L7: this asked for weight "the moment the floor is cleared", which was
    // the cliff itself — 0 below MIN_DECISIONS, 0.5 at it. The weight now
    // starts from nothing at the floor and grows with each decision after.
    const justAfter = await weightAt(MIN_DECISIONS + 1);
    check('no jump at the floor', atFloor < 0.1, `got ${atFloor}`);
    check('and weight grows from the next decision', justAfter > atFloor && justAfter < 0.1,
      `got ${justAfter}`);
    near('full weight at the full-weight sample', atFull, 1);
    near('and it never exceeds one', beyond, 1);
    check('weight only grows with evidence', atFloor <= atFull);
  }

  console.log('unattributed decisions still count, but only toward the pool');
  {
    /**
     * Records written before this existed, and hands where nobody was mapped,
     * have no opponent. They must not be silently filed under whoever happens
     * to be sitting there now — that would invent evidence.
     */
    const withAnonymous = [
      ...Array.from({ length: 30 }, () => bluff(false)),           // no opponent
      ...Array.from({ length: 30 }, () => bluff(true, 'rock')),
    ];
    const e = new LearningEngine();
    await e.loadStats(fakeDb(withAnonymous), 'rock');
    check('the anonymous ones do not join the opponent slice',
      e.getSnapshot().vsOpponent?.decisions === 30);

    const pooledOnly = new LearningEngine();
    await pooledOnly.loadStats(fakeDb(withAnonymous));
    check('but they do count toward the pooled history',
      pooledOnly.getSnapshot().totalDecisions === 60);
  }

  console.log('switching opponents switches the strategy');
  {
    /**
     * The whole point, stated as one sequence: the same engine, the same
     * stored history, asked about two different people, must answer
     * differently — and must not carry the first answer into the second.
     */
    const e = new LearningEngine();
    await e.loadStats(fakeDb(records), 'station');
    const against = e.getLearnedParams().bluffScale;
    await e.loadStats(fakeDb(records), 'rock');
    const then = e.getLearnedParams().bluffScale;
    check('the read changed with the opponent', against !== then,
      `both were ${against}`);
    check('and it is now the rock\'s read', then > 1, `got ${then}`);

    await e.loadStats(fakeDb(records), null);
    near('and clearing the opponent returns to pooled',
      e.getLearnedParams().bluffScale, 1);
  }

  if (failures > 0) {
    console.error(`\n${failures} per-opponent learning test(s) failed`);
    process.exit(1);
  }
  console.log('\nall per-opponent learning tests passed');
}

main();
