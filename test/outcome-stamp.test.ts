import { stampHandOutcome, DecisionRecord } from '../src/engine/learning';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

function rec(timestamp: number, outcome: 'win' | 'loss' | 'unknown' = 'unknown'): DecisionRecord {
  return {
    timestamp, sessionId: 's1', street: 'flop',
    holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] as DecisionRecord['holeCards'],
    communityCards: [], recommended: 'call', confidence: 60, equity: 50,
    potSize: 100, stackSize: 1000, outcome, profitLoss: 0,
    activePlayers: 2, position: 'BTN', boardWetness: 3, wasBluff: false,
  };
}

console.log('outcome stamping');

// Old hand's unresolved records must NOT be touched
{
  const oldHand = rec(1000);       // previous hand, never resolved
  const thisHand1 = rec(5000);
  const thisHand2 = rec(6000);
  const stamped = stampHandOutcome([oldHand, thisHand1, thisHand2], 4500, 'win', 250, 9000);

  expect('only current hand stamped (count)', stamped.length, 2);
  expect('old record untouched', oldHand.outcome, 'unknown');
  expect('current records get outcome', thisHand1.outcome, 'win');
  // L5: shared across the hand's decisions. All of it to the last one gave a
  // raise-bet-call hand's whole result to the call, and none to aggression.
  expect('profit is shared by the hand', thisHand2.profitLoss, 125);
  expect('including the earlier decision', thisHand1.profitLoss, 125);
}

// Already-resolved records are not re-stamped
{
  const resolved = rec(5000, 'loss');
  const stamped = stampHandOutcome([resolved], 4500, 'win', 100, 9000);
  expect('resolved records skipped', stamped.length, 0);
  expect('resolved outcome preserved', resolved.outcome, 'loss');
}

// Single-decision hand gets the full profit
{
  const only = rec(5000);
  stampHandOutcome([only], 4500, 'loss', -80, 9000);
  expect('single decision gets full P/L', only.profitLoss, -80);
  expect('single decision gets outcome', only.outcome, 'loss');
}

// L1/L2: the next hand's decisions are not this hand's.
//
// With only a start bound, every unresolved decision after the start was
// graded — so a hand graded late (the log lags the table by a hand) stamped
// the NEXT hand's decisions with its own result, and the correct grader then
// found nothing left.
{
  const thisHand = rec(5000);
  const nextHand = rec(9500);          // after this hand ended at 9000
  const stamped = stampHandOutcome([thisHand, nextHand], 4500, 'win', 300, 9000);
  expect('only this hand is graded', stamped.length, 1);
  expect('this hand takes the result', thisHand.outcome, 'win');
  expect('the next hand is left for its own grader', nextHand.outcome, 'unknown');

  // ...which then grades it with its own result
  stampHandOutcome([thisHand, nextHand], 9000, 'loss', -150, 14000);
  expect('and gets its own result', nextHand.outcome, 'loss');
  expect('with its own P/L', nextHand.profitLoss, -150);
}

process.exit(failures > 0 ? 1 : 0);
