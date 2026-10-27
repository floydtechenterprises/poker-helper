/**
 * D17: someone sitting down or leaving is not the button moving.
 *
 * The dealer seat is an index into the list of OCCUPIED seats. When a player
 * sits down in a seat ahead of the button, every index after it shifts by
 * one: the same player still has the button, but the index changed, and the
 * boundary tracker read that as a new hand — settling the hand in progress
 * mid-way, with a profit taken from a stack still in the middle of betting.
 *
 * The button is now followed by WHO holds it; the seat number is used only
 * when no name is available.
 */
import { HandBoundaryTracker } from '../src/content/hand-boundary';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\na player sits down ahead of the button mid-hand');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: 1, dealerName: 'Bob' });
  t.observe({ street: 'flop', yourStack: 9400, yourCurrentBet: 500, dealerSeat: 1, dealerName: 'Bob' });
  // Ann sits in seat 0: Bob, still on the button, is now index 2
  const r = t.observe({ street: 'flop', yourStack: 9400, yourCurrentBet: 500, dealerSeat: 2, dealerName: 'Bob' });
  expect('no hand is settled', r, null);
  expect('the hand is still open', t.hasOpenHand(), true);
}

console.log('\na player leaves ahead of the button mid-hand');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'turn', yourStack: 8000, yourCurrentBet: 0, dealerSeat: 3, dealerName: 'Cara' });
  const r = t.observe({ street: 'turn', yourStack: 8000, yourCurrentBet: 0, dealerSeat: 2, dealerName: 'Cara' });
  expect('no hand is settled', r, null);
}

console.log('\nthe button moving to another player still ends the hand');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: 1, dealerName: 'Bob' });
  // Heads-up, the button passes to us — same index count, different player
  const r = t.observe({ street: 'preflop', yourStack: 10100, yourCurrentBet: 50, dealerSeat: 0, dealerName: 'Hero' });
  expect('a hand is settled', r !== null, true);
  expect('with its result', r?.profitLoss, 150);
}

console.log('\nwithout names, the seat number still decides');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: 1 });
  const r = t.observe({ street: 'preflop', yourStack: 10100, yourCurrentBet: 50, dealerSeat: 0 });
  expect('a seat change is a new hand', r !== null, true);
}

console.log(failures > 0 ? `\n${failures} seat-change test(s) failed` : '\nall seat-change tests passed');
process.exit(failures > 0 ? 1 : 0);
