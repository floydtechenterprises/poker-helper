/**
 * A card that improves the BOARD is not an out.
 *
 * Holding 3s-3d on 3h-4h-5h-6h, every remaining heart puts five hearts on the
 * board and every 2 or 7 completes a straight there. All of them were counted
 * as our outs — 25 of them — and shown to the user as "Flush draw (9 outs)"
 * while we held no heart at all. They improve everyone equally: anyone with a
 * single heart beats the board flush and the rest chop.
 *
 * Same family as the barrelling bug, where a scare card was compared against
 * a board that already contained it: the code did not separate what WE have
 * from what is simply out there.
 */
import { countOuts, classifyHandStrength } from '../src/engine/postflop/hand-strength';
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
const HEARTS = 2;

console.log('\nboard-improving cards are not counted for us');
{
  // Four hearts and four to a straight on the board; we hold neither suit
  // nor a straight card beyond the trips we already have.
  const hole: [Card, Card] = [c(3, 3), c(3, 1)];
  const board = [c(3, HEARTS), c(4, HEARTS), c(5, HEARTS), c(6, HEARTS)];
  const { outs, draws } = countOuts(hole, board);

  expectTrue('outs are counted from our hand only', outs <= 12, `${outs}`);
  expectTrue('no flush draw is claimed without a heart',
    !draws.some(d => d.startsWith('Flush draw')), draws.join(','));

  const hs = classifyHandStrength(hole, board, outs);
  expectTrue('and it is not rated a monster draw', hs.drawStrength < 5, `${hs.drawStrength}`);
}

console.log('\ngenuine draws are untouched');
{
  const flush = countOuts([c(14, HEARTS), c(9, HEARTS)], [c(3, HEARTS), c(7, HEARTS), c(11, 0)]);
  expect('a real flush draw still counts nine', flush.outs, 9);
  expectTrue('and says so', flush.draws.some(d => d.startsWith('Flush draw')));

  const straight = countOuts([c(9, 0), c(8, 1)], [c(7, HEARTS), c(6, 3), c(2, 0)]);
  expect('a real open-ender still counts eight', straight.outs, 8);
  expectTrue('and says so', straight.draws.some(d => d.startsWith('Open-ended')));
}

console.log('\na made hand with a real draw keeps all of it');
{
  // Trips with four spades (we hold the 7s) plus a gutshot — every one of
  // these genuinely improves OUR hand.
  const { outs } = countOuts([c(7, 3), c(8, 0)], [c(8, HEARTS), c(9, 3), c(8, 3), c(5, 3)]);
  expectTrue('a legitimate monster keeps its outs', outs >= 20, `${outs}`);
}

console.log('\nnothing is nothing');
{
  const { outs, draws } = countOuts([c(9, 0), c(4, 1)], [c(14, HEARTS), c(7, 3), c(2, 0)]);
  expect('no draw, no outs', outs, 0);
  expect('and nothing claimed', draws.length, 0);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall outs-are-ours tests passed');
