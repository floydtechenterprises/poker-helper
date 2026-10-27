/**
 * Who acts last after the flop.
 *
 * Two bugs live here, and the second is the one I introduced fixing the
 * first:
 *
 *  1. The original test was `getPositionCategory(pos) === 'late'`. Heads-up
 *     the dealer is labelled SB, which categorises as 'blinds', so nobody
 *     ever had position and every positional play was silently disabled.
 *  2. My first fix special-cased "heads-up" using the count of ACTIVE
 *     players and the preflop label. But labels come from who was DEALT IN
 *     and never change when people fold — a six-handed pot folding to two
 *     leaves a CO and a BB, so the CO (who plainly acts last) read as out of
 *     position, and an SB (who acts first) would have read as in position.
 *
 * Acting order is the real question, so these test acting order.
 */
import { actsLastPostflop, hasPositionPostflop } from '../src/engine/position';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\nheads-up: the dealer acts last after the flop');
{
  // Seats 0 and 1, dealer on 0. Preflop the dealer acts first; postflop last.
  expect('the dealer has position', actsLastPostflop(0, 0, [0, 1]), true);
  expect('the other player does not', actsLastPostflop(1, 0, [0, 1]), false);
}

console.log('\nsix-handed folding to two: acting order, not the stale label');
{
  // Dealer on seat 0. Seats 4 (CO-ish) and 2 survive to the flop.
  // Postflop order runs 1,2,3,4,5,0 — so seat 4 acts after seat 2.
  expect('the later seat has position', actsLastPostflop(4, 0, [2, 4]), true);
  expect('the earlier seat does not', actsLastPostflop(2, 0, [2, 4]), false);
}

console.log('\nthe blinds act first postflop, however they are labelled');
{
  // Dealer on 0, so seat 1 is the SB. Full six-handed flop.
  const seats = [0, 1, 2, 3, 4, 5];
  expect('the SB does not have position', actsLastPostflop(1, 0, seats), false);
  expect('the BB does not either', actsLastPostflop(2, 0, seats), false);
  expect('the dealer does', actsLastPostflop(0, 0, seats), true);
}

console.log('\nthe dealer folding promotes whoever is next-closest');
{
  // Dealer on seat 5 but folded. Remaining 1 and 3; order is 0,1,2,3,4,5 from
  // the dealer, so seat 3 is nearest to the dealer going backwards.
  expect('seat 3 acts last', actsLastPostflop(3, 5, [1, 3]), true);
  expect('seat 1 does not', actsLastPostflop(1, 5, [1, 3]), false);
}

console.log('\nseat numbers wrap around the table');
{
  // Dealer on seat 4, survivors 0 and 4. Order from the dealer: 5,...,0,...,4
  expect('the dealer still acts last', actsLastPostflop(4, 4, [0, 4]), true);
  expect('the seat past the wrap does not', actsLastPostflop(0, 4, [0, 4]), false);
}

console.log('\ndegenerate inputs do not claim position falsely');
{
  expect('one player left acts last', actsLastPostflop(3, 0, [3]), true);
  expect('an unreadable dealer is not position', actsLastPostflop(1, -1, [0, 1]), false);
  expect('a seat not in the hand is not position', actsLastPostflop(9, 0, [0, 1]), false);
}

console.log('\nthe wrapper falls back to the label when seats are unusable');
{
  // Dealer unreadable: all we have is the preflop label, so 'late' stands in
  expect(
    'BTN label without seat data',
    hasPositionPostflop(0, -1, [0, 1], 'BTN'), true,
  );
  expect(
    'BB label without seat data',
    hasPositionPostflop(0, -1, [0, 1], 'BB'), false,
  );
  // With seat data the label is ignored entirely — this is the case that
  // was wrong before: SB heads-up IS the button
  expect(
    'seat data overrides a misleading SB label',
    hasPositionPostflop(0, 0, [0, 1], 'SB'), true,
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall acting-order tests passed');
