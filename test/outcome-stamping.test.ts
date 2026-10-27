/**
 * A decision that is never graded teaches nothing.
 *
 * The learning layer records a decision when it gives advice, and grades it
 * when the hand settles. Only GRADED decisions count toward the bluff and
 * call thresholds, so an ungraded store leaves every dial at neutral forever
 * — while looking perfectly healthy, because the decisions are all there.
 *
 * Observed live after the log reader finally worked: "300 decisions recorded,
 * 0 hands graded". The cause was the timestamp used to find a hand's
 * decisions. The log path passed `hand.startedAt`, which the tracker sets to
 * `Date.now()` when it READS the hand-start line — and PokerNow's log modal
 * lags the table by a hand, so that instant falls AFTER every decision the
 * hand contains.
 *
 * `stampHandOutcome` selects `timestamp >= handStartTs`. With a start time
 * from the future, that is the empty set, every time, silently.
 */
import { stampHandOutcome, DecisionRecord } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const CARD: Card = { rank: 14 as any, suit: 0 as any };
function decision(ts: number): DecisionRecord {
  return {
    timestamp: ts, sessionId: 's', street: 'flop',
    holeCards: [CARD, CARD], communityCards: [],
    recommended: 'bet', confidence: 60, equity: 0.5,
    potSize: 100, stackSize: 1000, outcome: 'unknown', profitLoss: 0,
    activePlayers: 2, position: 'BB', boardWetness: 0.3, wasBluff: true,
  };
}

console.log('the hand played at 1000-1300 is graded by its real start time');
{
  const records = [decision(1000), decision(1200), decision(1300)];
  const stamped = stampHandOutcome(records, 1000, 'win', 500, 9000);
  check('all three decisions are graded', stamped.length === 3, `got ${stamped.length}`);
  // L5: shared across the hand, and the hand's total stays exact
  check('the chips are shared by every decision in the hand',
    stamped.every(r => Math.abs(r.profitLoss - 500 / 3) < 1e-9)
    && stamped.reduce((s, r) => s + r.profitLoss, 0) === 500);
  check('and every one carries the outcome',
    stamped.every(r => r.outcome === 'win'));
}

console.log('a start time from the FUTURE grades nothing at all');
{
  /**
   * The live bug, stated as the arithmetic that caused it. The log read the
   * hand-start line at 1500, well after the hand's decisions at 1000-1300.
   */
  const records = [decision(1000), decision(1200), decision(1300)];
  const stamped = stampHandOutcome(records, 1500, 'win', 500, 9000);
  check('nothing is graded', stamped.length === 0);
  check('and the records stay unresolved',
    records.every(r => r.outcome === 'unknown'),
    'unresolved decisions never reach the bluff or call thresholds, so every '
    + 'strategy dial stays neutral no matter how much is played');
}

console.log('grading twice is harmless');
{
  /**
   * Both paths may stamp the same hand — the table boundary now grades every
   * hand, and the log path may still settle it. The second attempt must find
   * nothing rather than double-count the chips.
   */
  const records = [decision(1000), decision(1200)];
  const first = stampHandOutcome(records, 1000, 'loss', -200, 9000);
  const second = stampHandOutcome(records, 1000, 'loss', -200, 9000);
  check('the first pass grades them', first.length === 2);
  check('the second finds nothing left', second.length === 0,
    'stamping twice would double the chips attributed to one hand');
  check('and the loss is recorded once',
    records.reduce((s, r) => s + r.profitLoss, 0) === -200);
}

console.log('already-graded decisions from earlier hands are left alone');
{
  const older = decision(500);
  older.outcome = 'win';
  older.profitLoss = 900;
  const records = [older, decision(1000), decision(1200)];
  const stamped = stampHandOutcome(records, 600, 'loss', -300, 9000);
  check('only the unresolved ones are touched', stamped.length === 2);
  check('the earlier hand keeps its result',
    older.outcome === 'win' && older.profitLoss === 900);
}

if (failures > 0) {
  console.error(`\n${failures} outcome-stamping test(s) failed`);
  process.exit(1);
}
console.log('\nall outcome-stamping tests passed');
