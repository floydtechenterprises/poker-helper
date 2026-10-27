/**
 * Equity is stochastic, so the same spot must be asked only once.
 *
 * The symptom this fixes: 5000 Monte Carlo samples at 25% equity carry a
 * standard error near 0.6%, and the advisor re-ran it on every DOM mutation
 * while the user sat deciding. The displayed number wandered 24/25/26 and
 * the recommendation flipped between CALL and FOLD on a pot-odds boundary —
 * the spot was fine, the resampling was not.
 *
 * The key has to be exact in both directions: identical questions must
 * collide (or the flicker survives) and different questions must not (or an
 * answer gets reused for a hand it does not describe, which is far worse
 * than flicker).
 */
import { equityKey } from '../src/content/controller';
import { Card, Rank, Suit } from '../src/engine/types';
import { RangeSpec } from '../src/engine/equity/range-spec';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });
const spec = (o: Partial<RangeSpec> = {}): RangeSpec => ({
  percentile: 0.4, valueWeight: 0.5, minCategory: 2, valueOpponents: 1, ...o,
});

const HOLE = [c(14, 0), c(13, 1)];
const BOARD = [c(7, 0), c(2, 1), c(9, 2)];

console.log('\nthe same question collides regardless of card order');
{
  expect(
    'hole cards read in either order',
    equityKey([c(14, 0), c(13, 1)], BOARD, 1, spec()),
    equityKey([c(13, 1), c(14, 0)], BOARD, 1, spec()),
  );
  expect(
    'board cards read in any order',
    equityKey(HOLE, [c(7, 0), c(2, 1), c(9, 2)], 1, spec()),
    equityKey(HOLE, [c(9, 2), c(7, 0), c(2, 1)], 1, spec()),
  );
}

console.log('\ndifferent questions do not collide');
{
  const base = equityKey(HOLE, BOARD, 1, spec());

  const checks: [string, string][] = [
    ['a different hole card', equityKey([c(14, 0), c(12, 1)], BOARD, 1, spec())],
    ['a different suit', equityKey([c(14, 0), c(13, 2)], BOARD, 1, spec())],
    ['a turn card arriving', equityKey(HOLE, [...BOARD, c(5, 3)], 1, spec())],
    ['another opponent', equityKey(HOLE, BOARD, 2, spec())],
    ['a tighter range', equityKey(HOLE, BOARD, 1, spec({ percentile: 0.2 }))],
    ['more value-weighted', equityKey(HOLE, BOARD, 1, spec({ valueWeight: 0.9 }))],
    ['a higher minimum category', equityKey(HOLE, BOARD, 1, spec({ minCategory: 4 }))],
    ['a different number of bettors', equityKey(HOLE, BOARD, 1, spec({ valueOpponents: 2 }))],
  ];

  for (const [name, key] of checks) {
    if (key !== base) console.log(`  PASS ${name} is a different key`);
    else { console.error(`  FAIL ${name} collided with the base key`); failures++; }
  }
}

console.log('\nan absent bettor count is stable, not undefined-in-a-string');
{
  const a = equityKey(HOLE, BOARD, 1, {
    percentile: 0.4, valueWeight: 0.5, minCategory: 2,
  });
  const b = equityKey(HOLE, BOARD, 1, {
    percentile: 0.4, valueWeight: 0.5, minCategory: 2, valueOpponents: 0,
  });
  expect('missing and zero mean the same thing', a, b);
  if (!a.includes('undefined')) console.log('  PASS no undefined leaks into the key');
  else { console.error('  FAIL "undefined" appears in the key'); failures++; }
}

console.log('\nthe sample count is part of the question');
{
  // Analysis speed changes how precise the answer is. Sharing a cache entry
  // between 2000 and 20000 iterations makes the setting silently useless:
  // every spot already seen keeps its old, coarser number.
  const fast = equityKey(HOLE, BOARD, 1, spec(), 2000);
  const deep = equityKey(HOLE, BOARD, 1, spec(), 20000);
  if (fast !== deep) console.log('  PASS Fast and Deep are different keys');
  else { console.error('  FAIL Fast and Deep collided'); failures++; }

  expect(
    'the same setting still collides',
    equityKey(HOLE, BOARD, 1, spec(), 5000),
    equityKey(HOLE, BOARD, 1, spec(), 5000),
  );
}

console.log('\nnear-identical ranges stay distinguishable');
{
  // Rounded to three decimals — enough that genuinely different specs stay
  // apart, while float noise in the last bits does not split one spot into
  // two and reintroduce the resampling.
  const a = equityKey(HOLE, BOARD, 1, spec({ percentile: 0.4 }));
  const b = equityKey(HOLE, BOARD, 1, spec({ percentile: 0.4000001 }));
  const d = equityKey(HOLE, BOARD, 1, spec({ percentile: 0.405 }));
  expect('float noise collapses to one key', a, b);
  if (a !== d) console.log('  PASS a real difference still separates');
  else { console.error('  FAIL 0.400 and 0.405 collided'); failures++; }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall equity cache tests passed');
