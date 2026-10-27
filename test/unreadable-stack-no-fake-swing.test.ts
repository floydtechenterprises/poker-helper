/**
 * D13: one unreadable stack does not invent a loss and then a win.
 *
 * A hand's result is the stack when the next hand starts minus the stack when
 * it started. The chip text parses to 0 when it cannot be read, so a misread
 * at a hand boundary settled that hand as losing the whole stack, made 0 the
 * next hand's starting point, and settled that one as winning it all back —
 * two hands of fiction, both graded by the learning engine.
 */
import { HandBoundaryTracker } from '../src/content/hand-boundary';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\na stack that reads 0 at one boundary');
{
  const b = new HandBoundaryTracker();
  b.observe({ street: 'preflop', yourStack: 1000, yourCurrentBet: 0, dealerSeat: 0 });
  // Hand 2 starts, but the stack element is unreadable this tick
  const first = b.observe({ street: 'preflop', yourStack: 0, yourCurrentBet: 0, dealerSeat: 1 });
  expect('the hand is settled', first !== null, true);
  expect('without inventing a whole-stack loss', first?.profitLoss, 0);

  // The stack reads again mid-hand, then hand 3 starts
  b.observe({ street: 'preflop', yourStack: 1000, yourCurrentBet: 0, dealerSeat: 1 });
  b.observe({ street: 'flop', yourStack: 900, yourCurrentBet: 100, dealerSeat: 1 });
  const second = b.observe({ street: 'preflop', yourStack: 1150, yourCurrentBet: 0, dealerSeat: 0 });
  expect('and the next hand is not a fake whole-stack win', second?.profitLoss, 150);
}

console.log('\nordinary hands are unchanged');
{
  const b = new HandBoundaryTracker();
  b.observe({ street: 'preflop', yourStack: 1000, yourCurrentBet: 0, dealerSeat: 0 });
  const done = b.observe({ street: 'preflop', yourStack: 1200, yourCurrentBet: 0, dealerSeat: 1 });
  expect('a win of 200', done?.profitLoss, 200);
}

console.log(failures > 0 ? `\n${failures} stack test(s) failed` : '\nall stack tests passed');
process.exit(failures > 0 ? 1 : 0);
