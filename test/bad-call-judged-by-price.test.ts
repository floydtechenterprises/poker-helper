/**
 * L4: a bad call is a losing call made WITHOUT the price.
 *
 * The rule, and the comments on both the stat and the adjustment, say "equity
 * below what pot odds required". The code used a fixed 35%. So a correct call
 * at 30% equity getting 4:1 that lost was counted as a mistake, and a call at
 * 40% needing 50% that lost was not. callMargin learned to fold calls that
 * were right and never learned from the ones that were wrong.
 *
 * Records now carry the price they were made on; records from before that
 * keep the old bar rather than being re-priced on a guess.
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function calls(n: number, equity: number, priceNeeded: number | undefined): DecisionRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: i, sessionId: 's', street: 'river' as const,
    holeCards: [c(10, 0), c(9, 1)] as [Card, Card], communityCards: [],
    recommended: 'call' as const, confidence: 55, equity,
    potSize: 800, stackSize: 4000,
    outcome: 'loss' as const, profitLoss: -100,
    activePlayers: 2, position: 'BB', boardWetness: 3, wasBluff: false,
    priceNeeded,
  }));
}

function foldsMore(records: DecisionRecord[]): boolean {
  const engine = new LearningEngine();
  (engine as unknown as { stats: unknown }).stats =
    (engine as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return engine.getAdjustments().some(a => a.type === 'fold-threshold');
}
const n = Math.max(MIN_DECISIONS, 60);

console.log('\nlosing calls that had the price');
check('do not teach folding', !foldsMore(calls(n, 30, 20)),
  '30% equity against a 20% price is a correct call, however it ended');

console.log('\nlosing calls that did not have the price');
check('do teach folding', foldsMore(calls(n, 40, 50)),
  '40% equity against a 50% price is a mistake even though it clears 35%');

console.log('\nrecords without a price keep the old bar');
check('below 35% still counts', foldsMore(calls(n, 30, undefined)));

console.log(failures > 0 ? `\n${failures} bad-call test(s) failed` : '\nall bad-call tests passed');
process.exit(failures > 0 ? 1 : 0);
