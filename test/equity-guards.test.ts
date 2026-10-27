/**
 * Input validation for the equity system, and the range spec's bounds.
 *
 * The theme across this system is that bad input produced a plausible
 * number rather than an error, and the worker's result OVERRIDES the main
 * thread's — so any disagreement between the two paths is invisible by
 * construction. These tests pin the main-thread half; the worker shares the
 * same checks and now the same percentile implementation.
 */
import { calculateEquity } from '../src/engine/equity/monte-carlo';
import { toRangeSpec, CATEGORY, valueSplitFor } from '../src/engine/equity/range-spec';
import { handPercentile, rawHandScore } from '../src/engine/equity/hand-percentile';
import { Card, Rank, Suit } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectThrows(name: string, fn: () => unknown): void {
  try { fn(); console.error(`  FAIL ${name}: did not throw`); failures++; }
  catch { console.log(`  PASS ${name}`); }
}
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });
const HOLE: [Card, Card] = [c(14, 3), c(13, 3)];
const FLOP = [c(9, 0), c(4, 1), c(2, 2)];

console.log('\ncalculateEquity refuses input it cannot answer');
{
  expectThrows('six board cards', () => calculateEquity(HOLE, [...FLOP, c(5, 0), c(6, 1), c(7, 2)], 1, 200));
  expectThrows('zero opponents', () => calculateEquity(HOLE, FLOP, 0, 200));
  expectThrows('more opponents than the deck can seat', () => calculateEquity(HOLE, FLOP, 30, 200));
  expectTrue('a normal spot still runs', calculateEquity(HOLE, FLOP, 1, 200).samples === 200);
}

console.log('\na card cannot be in two places');
{
  // The ace of spades is both a hole card and on the board. `excluded` is a
  // Set, so this used to collapse silently and leave a live card in the deck
  // that was already in play.
  expectThrows('hole card duplicated on the board',
    () => calculateEquity(HOLE, [c(14, 3), c(4, 1), c(2, 2)], 1, 200));
  expectThrows('the board repeats a card',
    () => calculateEquity(HOLE, [c(9, 0), c(9, 0), c(2, 2)], 1, 200));
  expectThrows('both hole cards identical',
    () => calculateEquity([c(9, 0), c(9, 0)], FLOP, 1, 200));
}

console.log('\ntoRangeSpec clamps what it is given');
{
  expect('percentile above 1', toRangeSpec(1.8).percentile, 1);
  expect('percentile below 0', toRangeSpec(-0.5).percentile, 0);
  expect('NaN percentile falls back to any-two', toRangeSpec(NaN).percentile, 1);

  const wild = toRangeSpec({ percentile: 5, valueWeight: 9, minCategory: 99 });
  expect('spec percentile clamped', wild.percentile, 1);
  expect('spec valueWeight clamped', wild.valueWeight, 1);
  expect('spec minCategory clamped', wild.minCategory, CATEGORY.STRAIGHT_FLUSH);

  const neg = toRangeSpec({ percentile: -1, valueWeight: -1, minCategory: -3 });
  expect('negative percentile clamped', neg.percentile, 0);
  expect('negative valueWeight clamped', neg.valueWeight, 0);
  expect('negative minCategory clamped', neg.minCategory, 0);

  // valueOpponents must survive — it is not a 0-1 quantity
  expect('valueOpponents passes through',
    toRangeSpec({ percentile: 0.4, valueWeight: 0.5, minCategory: 1, valueOpponents: 3 }).valueOpponents, 3);
}

console.log('\nthe percentile table is the one both threads share');
{
  // AA must be the strongest hand, 72o among the weakest
  const aa = handPercentile(c(14, 0), c(14, 1));
  const junk = handPercentile(c(7, 0), c(2, 1));
  expectTrue('AA is at the top', aa < 0.02, `got ${aa}`);
  expectTrue('72o is near the bottom', junk > 0.8, `got ${junk}`);
  expectTrue('AA scores higher than 72o',
    rawHandScore(c(14, 0), c(14, 1)) > rawHandScore(c(7, 0), c(2, 1)));

  // Suitedness and connectedness must both help
  expectTrue('suited beats offsuit',
    handPercentile(c(14, 0), c(5, 0)) < handPercentile(c(14, 0), c(5, 1)));
  expectTrue('connected beats gapped',
    handPercentile(c(9, 0), c(8, 1)) < handPercentile(c(9, 0), c(4, 1)));

  // Monotonic: a percentile is a fraction
  expectTrue('every percentile is in range',
    [aa, junk, handPercentile(c(10, 0), c(10, 1))].every(p => p >= 0 && p <= 1));
}

console.log('\nvalueSplitFor stays inside its documented bounds');
{
  for (const street of ['flop', 'turn', 'river'] as const) {
    for (const betToPot of [0.1, 0.5, 1, 3, 100]) {
      for (const allIn of [true, false]) {
        for (const bluffiness of [0, 0.5, 1]) {
          const r = valueSplitFor({ street, betToPot, allIn, bluffiness });
          if (r.valueWeight < 0 || r.valueWeight > 0.9) {
            console.error(`  FAIL weight out of bounds: ${r.valueWeight} (${street} ${betToPot})`);
            failures++;
          }
          if (r.minCategory < 0 || r.minCategory > CATEGORY.STRAIGHT_FLUSH) {
            console.error(`  FAIL minCategory out of bounds: ${r.minCategory}`);
            failures++;
          }
        }
      }
    }
  }
  console.log('  PASS weight and category stay bounded across every combination');

  // Preflop and checked-to spots disable the filter entirely
  expect('preflop disables the value filter',
    valueSplitFor({ street: 'preflop', betToPot: 1, allIn: false }).valueWeight, 0);
  expect('a zero bet disables it too',
    valueSplitFor({ street: 'river', betToPot: 0, allIn: false }).valueWeight, 0);
}

console.log('\nbigger bets and later streets mean stronger ranges');
{
  const small = valueSplitFor({ street: 'flop', betToPot: 0.3, allIn: false });
  const big = valueSplitFor({ street: 'flop', betToPot: 1.2, allIn: false });
  expectTrue('a bigger bet is more often value', big.valueWeight > small.valueWeight);

  const flop = valueSplitFor({ street: 'flop', betToPot: 0.8, allIn: false });
  const river = valueSplitFor({ street: 'river', betToPot: 0.8, allIn: false });
  expectTrue('the river is more often value than the flop', river.valueWeight > flop.valueWeight);

  const honest = valueSplitFor({ street: 'river', betToPot: 0.8, allIn: false, bluffiness: 0.1 });
  const bluffer = valueSplitFor({ street: 'river', betToPot: 0.8, allIn: false, bluffiness: 0.9 });
  expectTrue('a known bluffer widens the range', bluffer.valueWeight < honest.valueWeight);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall equity guard tests passed');
