/**
 * L6: learning's profit thresholds are measured in big blinds, not chips.
 *
 * "Aggression is bleeding / printing" fired at ±8 chips per decision, "thin
 * value losing" at -5, "losing from the blinds" at -100 in total. A
 * hyper-turbo's blinds rise twelvefold and more, so the same play crossed a
 * threshold late in a match and not early in it: 8 chips is 0.4 bb at 10/20
 * and 0.03 bb at 150/300. The rules now read results in big blinds, at the
 * scale they were set for (10/20), and records with no recorded big blind
 * are left out rather than guessed.
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function record(i: number, over: Partial<DecisionRecord>): DecisionRecord {
  return {
    timestamp: i, sessionId: 's', street: 'flop', handStart: i,
    holeCards: [c(13, 0), c(12, 1)], communityCards: [c(2, 2), c(7, 3), c(9, 0)],
    recommended: 'bet', confidence: 60, equity: 55,
    potSize: 400, stackSize: 4000,
    outcome: 'win', profitLoss: 20,
    activePlayers: 2, tableSize: 6, position: 'BTN', boardWetness: 2, wasBluff: false,
    ...over,
  } as DecisionRecord;
}
function adjustments(records: DecisionRecord[]) {
  const engine = new LearningEngine();
  (engine as unknown as { stats: unknown }).stats =
    (engine as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return engine.getAdjustments().map(a => a.description);
}
const n = MIN_DECISIONS + 20;
const has = (list: string[], re: RegExp) => list.some(d => re.test(d));

console.log('\nthe same result in big blinds reads the same at any level');
{
  // Every bet wins a tenth of a big blind — nothing to conclude
  const low = adjustments(Array.from({ length: n }, (_, i) => record(i, { profitLoss: 2, bigBlind: 20 })));
  const high = adjustments(Array.from({ length: n }, (_, i) => record(i, { profitLoss: 30, bigBlind: 300 })));
  check('0.1 bb a decision at 10/20 is not "printing"', !has(low, /printing/));
  check('0.1 bb a decision at 150/300 is not "printing" either', !has(high, /printing/),
    '30 chips crossed the 8-chip threshold at the high level');

  // A full big blind a decision is printing wherever it happens
  const bigLow = adjustments(Array.from({ length: n }, (_, i) => record(i, { profitLoss: 20, bigBlind: 20 })));
  const bigHigh = adjustments(Array.from({ length: n }, (_, i) => record(i, { profitLoss: 300, bigBlind: 300 })));
  check('1 bb a decision at 10/20 is printing', has(bigLow, /printing/));
  check('1 bb a decision at 150/300 is printing', has(bigHigh, /printing/));
}

console.log('\nlosing thin value, at a high level');
{
  // -0.1 bb per thin bet at 150/300 — 30 chips, past the old -5 chip bar
  const high = adjustments(Array.from({ length: n }, (_, i) => record(i, {
    outcome: 'loss', profitLoss: -30, bigBlind: 300, equity: 52,
  })));
  check('a tenth of a big blind is not "thin value losing"', !has(high, /Thin value bets losing/));
}

console.log('\nlosing from the blinds, at a 6-max table');
{
  // 6 hands, each losing a tenth of a big blind from the BB at 150/300
  const records = Array.from({ length: n }, (_, i) => record(i, {
    recommended: 'check', position: i < 6 ? 'BB' : 'BTN',
    outcome: i < 6 ? 'loss' : 'win', profitLoss: i < 6 ? -30 : 0, bigBlind: 300,
  }));
  check('0.6 bb in total is not a blind leak', !has(adjustments(records), /Losing from BB/),
    '180 chips crossed the -100 chip threshold');
}

console.log('\nrecords with no big blind are not guessed at');
{
  const legacy = adjustments(Array.from({ length: n }, (_, i) => record(i, { profitLoss: 500 })));
  check('no conclusion from chips of unknown size', !has(legacy, /printing/));
}

console.log(failures > 0 ? `\n${failures} big-blind test(s) failed` : '\nall big-blind tests passed');
process.exit(failures > 0 ? 1 : 0);
