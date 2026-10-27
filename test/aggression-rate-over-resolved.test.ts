/**
 * L3: aggression profit is measured per graded decision.
 *
 * The aggression check divided profit by EVERY recorded decision, including
 * chopped pots and hands whose result was never stamped. Profit only ever
 * comes from graded decisions, so each ungraded one pulled the rate toward
 * zero, and the ±8 thresholds became harder to reach the more data was
 * missing — exactly backwards for a read about what worked.
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
    timestamp: i, sessionId: 's', street: 'flop',
    holeCards: [c(13, 0), c(12, 1)], communityCards: [c(2, 2), c(7, 3), c(9, 0)],
    recommended: 'bet', confidence: 60, equity: 0.55,
    potSize: 400, stackSize: 4000,
    outcome: 'win', profitLoss: 20, bigBlind: 20, // chips at 10/20 (L6 reads big blinds)
    activePlayers: 2, position: 'SB', boardWetness: 2, wasBluff: false,
    ...over,
  } as DecisionRecord;
}

function adjustments(records: DecisionRecord[]) {
  const engine = new LearningEngine();
  (engine as unknown as { stats: unknown }).stats =
    (engine as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return engine.getAdjustments();
}

console.log('\nwinning aggression, diluted by ungraded decisions');
{
  const records: DecisionRecord[] = [];
  // 40 graded bets, each winning 20 chips: 20 per graded decision
  for (let i = 0; i < 40; i++) records.push(record(i, {}));
  // Enough ungraded decisions to push the total past the sample floor
  for (let i = 0; i < MIN_DECISIONS + 100; i++) {
    records.push(record(100 + i, { recommended: 'check', outcome: 'unknown', profitLoss: 0 }));
  }
  const printing = adjustments(records).some(a => /Aggression is printing/.test(a.description));
  check('the engine still sees aggression printing', printing,
    'profit per decision was divided by the ungraded decisions too');
}

console.log(failures > 0 ? `\n${failures} aggression test(s) failed` : '\nall aggression tests passed');
process.exit(failures > 0 ? 1 : 0);
