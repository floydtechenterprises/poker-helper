/**
 * The evaluators must refuse wrong-length input, not score it.
 *
 * Every bug in this system had the same shape: a confident wrong answer.
 * `suits.every(...)` is vacuously true on an empty array, so four suited
 * cards — or none at all — came back as a FLUSH. `evaluate7` given six cards
 * produced four-card subsets internally and inherited it. None of it threw,
 * none of it logged, and a flush that does not exist looks exactly like one
 * that does everywhere downstream.
 *
 * These tests exist so the guards cannot be removed as "defensive noise".
 */
import { evaluate5, evaluate6, evaluate7, handCategoryName } from '../src/engine/hand-evaluator';
import { evaluate7Fast } from '../src/engine/fast-evaluator';
import { calculateEquity } from '../src/engine/equity/monte-carlo';
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

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });

/** Four spades — a flush ONLY if the evaluator is broken. */
const FOUR_SPADES = [c(14, 3), c(13, 3), c(12, 3), c(11, 3)];

console.log('\nevaluate5 refuses anything that is not five cards');
{
  expectThrows('empty', () => evaluate5([]));
  expectThrows('four cards', () => evaluate5(FOUR_SPADES));
  expectThrows('two cards (a preflop holding)', () => evaluate5([c(14, 0), c(13, 0)]));
  expectThrows('six cards', () => evaluate5([...FOUR_SPADES, c(2, 2), c(3, 1)]));
  // ...and still scores a real five correctly
  expect(
    'five spades is genuinely a flush',
    handCategoryName(evaluate5([...FOUR_SPADES, c(9, 3)])), 'flush',
  );
}

console.log('\nevaluate7 refuses six cards — the turn, with hole cards');
{
  const six = [...FOUR_SPADES, c(2, 2), c(3, 1)];
  expectThrows('six cards', () => evaluate7(six));
  // evaluate6 is the right tool and gets it right
  expect('evaluate6 scores it as high card', handCategoryName(evaluate6(six)), 'high-card');
}

console.log('\nevaluate6 refuses anything that is not six');
{
  expectThrows('five cards', () => evaluate6([...FOUR_SPADES, c(9, 0)]));
  expectThrows('seven cards', () => evaluate6([...FOUR_SPADES, c(9, 0), c(5, 1), c(6, 2)]));
}

console.log('\nevaluate7Fast refuses anything that is not seven');
{
  expectThrows('four cards', () => evaluate7Fast(FOUR_SPADES));
  expectThrows('five cards', () => evaluate7Fast([...FOUR_SPADES, c(9, 0)]));
  // Eight would break the flush-before-full-house ordering
  expectThrows('eight cards', () => evaluate7Fast([
    ...FOUR_SPADES, c(9, 0), c(5, 1), c(6, 2), c(7, 2),
  ]));
}

console.log('\nfour suited cards are never a flush, whichever path is taken');
{
  // The original failure, stated directly
  const six = [...FOUR_SPADES, c(2, 2), c(3, 1)];
  expect('six-card board scores as high card', handCategoryName(evaluate6(six)), 'high-card');
  const seven = [...FOUR_SPADES, c(2, 2), c(3, 1), c(9, 0)];
  expect('seven-card scores as high card', handCategoryName(evaluate7(seven)), 'high-card');
  expect('and the fast path agrees', handCategoryName(evaluate7Fast(seven)), 'high-card');
}

console.log('\ncalculateEquity refuses a malformed board, as the worker does');
{
  const hole: [Card, Card] = [c(9, 0), c(4, 1)];
  const board6 = [...FOUR_SPADES, c(2, 2), c(3, 1)];

  /**
   * It THROWS rather than returning zeros, and that distinction is the
   * whole point. The advisor wraps its analysis in a catch that shows
   * "Analysis error — retrying..." on the overlay, so a throw is something
   * the user can see. An equity of 0 would read as "you cannot win this
   * hand" and produce a confident fold showing 0% — the same confident
   * wrong answer, one layer further along.
   */
  expectThrows('six board cards', () => calculateEquity(hole, board6, 1, 500));
  expectThrows('zero opponents', () => calculateEquity(hole, FOUR_SPADES.slice(0, 3), 0, 500));
  expectThrows('one hole card', () => calculateEquity([c(9, 0)] as any, [], 1, 500));

  // A normal board still works — the guard must not swallow real input
  const ok = calculateEquity(hole, FOUR_SPADES.slice(0, 3), 1, 500);
  expect('a three-card flop still runs', ok.samples, 500);
  if (ok.equity > 0 && ok.equity < 1) console.log('  PASS and returns a usable equity');
  else { console.error(`  FAIL equity out of range: ${ok.equity}`); failures++; }
}

console.log('\ntwo pair keeps the higher pair first');
{
  // Kings and fours with a queen kicker
  const r = evaluate5([c(13, 0), c(13, 1), c(4, 2), c(4, 3), c(12, 0)]);
  expect('category is two-pair', handCategoryName(r), 'two-pair');
  expect('high pair is kings', (r >> 16) & 0xF, 13);
  expect('low pair is fours', (r >> 12) & 0xF, 4);
  expect('kicker is the queen', (r >> 8) & 0xF, 12);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall evaluator guard tests passed');
