/**
 * Never having seen the button is not the same as the button being on seat 0.
 *
 * `lastKnownDealerSeat` started at 0, so the very first read with the button
 * missing — mid-animation, or before it renders — returned seat 0. That is
 * exactly the silent default the fallback exists to prevent, and every
 * position for that hand is then derived from a seat nobody is sitting on.
 *
 * It also never reset, so moving to a new table carried the previous game's
 * button across.
 *
 * The engine already handles an unknown button honestly: `getPosition` falls
 * back, `hasPositionPostflop` uses the preflop label, and
 * `positionCategoryOfSeat` returns null.
 */
import { readDealerSeatIndex, resetDealerSeat } from '../src/content/scraper/player-reader';
import { getPosition, hasPositionPostflop, positionCategoryOfSeat } from '../src/engine/position';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

/** A page with no dealer button and no seats. */
function emptyPage(): void {
  (globalThis as { document?: unknown }).document = {
    querySelector: () => null,
    querySelectorAll: () => ({ length: 0, forEach: () => {} }),
  };
}

console.log('\nan unseen button reports unknown, not seat zero');
{
  emptyPage();
  resetDealerSeat();
  expect('no button has ever been seen', readDealerSeatIndex(), -1);
}

console.log('\nthe engine treats unknown as unknown');
{
  const seats = [0, 1, 2, 3, 4, 5];
  // getPosition with an out-of-range dealer must not silently claim seat 0's
  // position for us
  const pos = getPosition(3, -1, seats);
  expect('a position is still produced', typeof pos, 'string');
  expect('postflop position falls back to the label',
    hasPositionPostflop(0, -1, [0, 1], 'BB'), false);
  expect('and an opponent category is null rather than guessed',
    positionCategoryOfSeat(1, -1, seats), null);
}

console.log('\nthe button is forgotten between sessions');
{
  emptyPage();
  resetDealerSeat();
  expect('reset restores unknown', readDealerSeatIndex(), -1);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall dealer seat tests passed');
