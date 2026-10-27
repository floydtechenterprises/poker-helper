/**
 * The bluffing story has to be true.
 *
 * `credibility` is one of only two things that unlock a late-street bluff
 * with no pair and no draw, and almost every branch that builds it is gated
 * on being the preflop aggressor — representing an overpair, a set, top
 * pair. The advisor passed `true` unconditionally, so a hand we merely
 * CALLED preflop claimed the raiser's range anyway.
 *
 * The frequency gate is here too: it promises the same hand on the same
 * board always gets the same answer, and it hashed cards in array order, so
 * a scraper returning hole cards the other way round could flip the roll.
 */
import { analyzeRangeRepresentation } from '../src/engine/postflop/range-representation';
import { bluffFrequencyGate } from '../src/engine/postflop/bluff-gate';
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { Card, Rank, Suit } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });
const BOARD = [c(11, 0), c(9, 1), c(4, 2)];
const HOLE: [Card, Card] = [c(14, 3), c(13, 3)];

console.log('\nonly the preflop raiser gets the raiser’s story');
{
  const texture = analyzeBoardTexture(BOARD);
  const raiser = analyzeRangeRepresentation(HOLE, BOARD, texture, 'flop', true, true);
  const caller = analyzeRangeRepresentation(HOLE, BOARD, texture, 'flop', false, true);

  expectTrue('raising preflop buys credibility',
    raiser.credibility > caller.credibility, `${raiser.credibility} vs ${caller.credibility}`);
  expect('a caller cannot claim an overpair', caller.canRepresentOverpair, false);
  expect('a raiser can', raiser.canRepresentOverpair, true);
  expect('a caller cannot claim a set', caller.canRepresentSet, false);
}

console.log('\nthe frequency gate ignores card order');
{
  const a = bluffFrequencyGate([c(14, 3), c(13, 3)], BOARD, 'turn', 0);
  const b = bluffFrequencyGate([c(13, 3), c(14, 3)], BOARD, 'turn', 0);
  expect('hole cards either way round give one answer', a.roll, b.roll);
  expect('and the same verdict', a.allowed, b.allowed);

  const boardA = bluffFrequencyGate(HOLE, [c(11, 0), c(9, 1), c(4, 2)], 'turn', 0);
  const boardB = bluffFrequencyGate(HOLE, [c(4, 2), c(11, 0), c(9, 1)], 'turn', 0);
  expect('board order does not change it', boardA.roll, boardB.roll);
}

console.log('\nthe gate still discriminates between different hands');
{
  const rolls = new Set<number>();
  for (let r = 2; r <= 14; r++) rolls.add(bluffFrequencyGate([c(r, 0), c(7, 1)], BOARD, 'turn', 0).roll);
  expectTrue('different hands get different rolls', rolls.size >= 10, `${rolls.size} distinct`);

  // And a hand is stable across repeated calls
  const first = bluffFrequencyGate(HOLE, BOARD, 'river', 5).roll;
  const again = bluffFrequencyGate(HOLE, BOARD, 'river', 5).roll;
  expect('the same spot re-read gives the same roll', first, again);
}

console.log('\nblockers earn a bigger share of the bluffing range');
{
  const plain = bluffFrequencyGate(HOLE, BOARD, 'turn', 0).frequency;
  const blocking = bluffFrequencyGate(HOLE, BOARD, 'turn', 25).frequency;
  expectTrue('blockers widen the frequency', blocking > plain, `${blocking} vs ${plain}`);
  expectTrue('and it stays a probability', blocking <= 1 && plain >= 0);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall bluff story tests passed');
