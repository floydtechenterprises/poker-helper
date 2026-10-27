/**
 * An unknown dealer seat must not look like the button moving.
 *
 * `readDealerSeatIndex` reports -1 until it has actually located the button,
 * rather than defaulting to seat 0 and deriving every position from a seat
 * nobody occupies. That makes the value honest — and made this comparison
 * dangerous, because the boundary tracker treats any CHANGE of dealer seat as
 * a new hand.
 *
 * So the first time the button became readable, -1 → 0 read as the button
 * moving: a phantom hand boundary, settled with a profit figure computed from
 * two stacks that belong to different moments.
 *
 * This is a regression introduced by fixing the dealer default — the kind
 * that only appears where two systems meet.
 */
import { HandBoundaryTracker } from '../src/content/hand-boundary';
import { getPosition } from '../src/engine/position';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\nthe button becoming readable is not a new hand');
{
  const t = new HandBoundaryTracker();
  // Button not located yet
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: -1 });
  t.observe({ street: 'flop', yourStack: 9900, yourCurrentBet: 0, dealerSeat: -1 });
  // Now it renders
  const r = t.observe({ street: 'flop', yourStack: 9900, yourCurrentBet: 0, dealerSeat: 0 });
  expect('no phantom hand is settled', r, null);
}

console.log('\nthe button genuinely moving still ends the hand');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: 0 });
  t.observe({ street: 'flop', yourStack: 9800, yourCurrentBet: 0, dealerSeat: 0 });
  const r = t.observe({ street: 'preflop', yourStack: 10200, yourCurrentBet: 50, dealerSeat: 1 });
  expect('a hand completes', r !== null, true);
  expect('with the right profit', r?.profitLoss, 10250 - 10000);
}

console.log('\nlosing the button mid-hand does not end it');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: 0 });
  // Button vanishes during an animation
  const r = t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: -1 });
  expect('no boundary from a vanishing button', r, null);
  // And it coming back to the SAME seat is still not a move
  const r2 = t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100, dealerSeat: 0 });
  expect('nor from it returning unchanged', r2, null);
}

console.log('\nthe street rolling back still ends the hand');
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 9900, yourCurrentBet: 100 });
  t.observe({ street: 'river', yourStack: 9500, yourCurrentBet: 0 });
  const r = t.observe({ street: 'preflop', yourStack: 10500, yourCurrentBet: 50 });
  expect('a hand completes without any button data', r !== null, true);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall boundary tests passed');

console.log('\nan unknown button does not widen the range we open');
{
  // Same principle one layer up: getPosition treated an unlocated button as
  // "seat 0 is the dealer", which decides the entire preflop range. Heads-up
  // that could hand us the button's 88% opening range while we were actually
  // in the big blind.
  expect('heads-up defaults to the out-of-position seat',
    getPosition(0, -1, [0, 1]), 'BB');
  expect('multiway defaults to first to act',
    getPosition(3, -1, [0, 1, 2, 3, 4, 5]), 'UTG');
  // And a known button is unaffected
  expect('a located button still resolves',
    getPosition(0, 0, [0, 1]), 'SB');
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall unknown-button tests passed');
