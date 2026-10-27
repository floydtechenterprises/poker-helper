/**
 * A misread table must not make us play MORE hands.
 *
 * `getPosition` returned 'BTN' when our seat was not among the dealt-in
 * seats — so a scraping failure told the engine we had the button: the
 * widest opening range and the loosest postflop play. If position cannot be
 * determined the safe assumption is that we act first, not last.
 */
import { getPosition, getPositionCategory, hasPositionPostflop } from '../src/engine/position';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\nan unreadable seat is the worst position, not the best');
{
  // Six dealt-in seats, none of them ours
  expect('our seat missing from the table', getPosition(9, 0, [0, 1, 2, 3, 4, 5]), 'UTG');
  expect('and it categorises as early', getPositionCategory(getPosition(9, 0, [0, 1, 2, 3, 4, 5])), 'early');
}

console.log('\nreal seats still map correctly');
{
  const six = [0, 1, 2, 3, 4, 5];
  expect('dealer is the button', getPosition(0, 0, six), 'BTN');
  expect('one after the dealer is the small blind', getPosition(1, 0, six), 'SB');
  expect('two after is the big blind', getPosition(2, 0, six), 'BB');
  expect('heads-up dealer is the small blind', getPosition(0, 0, [0, 1]), 'SB');
  expect('heads-up other seat is the big blind', getPosition(1, 0, [0, 1]), 'BB');
}

console.log('\nthe dealer seat being empty does not break the mapping');
{
  // Dealer marked on seat 3, which nobody occupies
  const seats = [0, 1, 4, 5];
  const pos = getPosition(4, 3, seats);
  if (['SB', 'BB', 'BTN', 'CO', 'UTG', 'MP'].includes(pos)) {
    console.log(`  PASS an empty dealer seat still resolves (${pos})`);
  } else { console.error(`  FAIL got ${pos}`); failures++; }
}

console.log('\nthe postflop fallback is conservative too');
{
  // No seat data at all: the label decides, and an unknown label is not late
  expect('unreadable dealer with a UTG label',
    hasPositionPostflop(0, -1, [0, 1], 'UTG'), false);
  expect('unreadable dealer with a BTN label',
    hasPositionPostflop(0, -1, [0, 1], 'BTN'), true);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall position fallback tests passed');
