/**
 * Board texture and relative hand strength.
 *
 * The bug that mattered here: a straight made with BOTH hole cards was
 * classified 'medium'. The test asked whether a hole card's rank appeared on
 * the board — so on 9-T-J holding Q-8, where you hold the straight itself,
 * neither Q nor 8 is on the board and the strongest way to hold a straight
 * scored as one of the weakest. 'medium' hands do not raise for value.
 */
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { classifyHandStrength } from '../src/engine/postflop/hand-strength';
import { analyzeBlockers } from '../src/engine/postflop/blockers';
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
const S = 3, H = 2, D = 1, C = 0;

console.log('\na straight you made yourself is strong, not medium');
{
  // 9-T-J board, holding Q-8: we hold Q-J-T-9-8 using both cards
  const made = classifyHandStrength([c(12, S), c(8, H)], [c(9, D), c(10, C), c(11, S)]);
  expect('both hole cards making the straight', made.relative, 'strong');

  // One hole card completing it is still ours
  const one = classifyHandStrength([c(12, S), c(3, H)], [c(9, D), c(10, C), c(11, S), c(13, H), c(2, C)]);
  expect('one hole card completing it', one.relative, 'strong');
}

console.log('\na straight sitting on the board is only medium');
{
  // Board is 9-T-J-Q-K: everyone has it, our cards change nothing
  const boardStraight = classifyHandStrength(
    [c(2, S), c(3, H)], [c(9, D), c(10, C), c(11, S), c(12, H), c(13, C)],
  );
  expect('board makes the same straight', boardStraight.relative, 'medium');
}

console.log('\nfour to a flush is not a flush on the board');
{
  const fourFlush = analyzeBoardTexture([c(14, S), c(9, S), c(5, S), c(2, S), c(7, H)]);
  expectTrue('summary does not claim a flush is on the board',
    !fourFlush.summary.includes('flush on board'), fourFlush.summary);
  expectTrue('it warns one card makes it',
    fourFlush.summary.includes('one card makes it'), fourFlush.summary);

  const realFlush = analyzeBoardTexture([c(14, S), c(9, S), c(5, S), c(2, S), c(7, S)]);
  expectTrue('five of a suit really is a flush on the board',
    realFlush.summary.includes('flush on board'), realFlush.summary);
}

console.log('\na completed straight is not also counted as drawing');
{
  // 5-6-7-8-9 on the board: complete, and no cards to come
  const complete = analyzeBoardTexture([c(5, S), c(6, H), c(7, D), c(8, C), c(9, S)]);
  expect('straightComplete', complete.straightComplete, true);
  expect('and not simultaneously a draw', complete.straightDraw, false);

  // A made straight on the TURN must not flag higher windows as draws
  const turnComplete = analyzeBoardTexture([c(5, S), c(6, H), c(7, D), c(8, C)]);
  expectTrue('four to a straight on the turn is a draw, not complete',
    !turnComplete.straightComplete);
}

console.log('\nwetness stays inside its range on every board');
{
  const boards: Card[][] = [
    [],
    [c(2, C), c(7, D), c(9, H)],
    [c(9, S), c(10, S), c(11, S)],
    [c(9, S), c(10, S), c(11, S), c(12, S), c(13, S)],
    [c(2, S), c(2, H), c(2, D), c(2, C), c(9, S)],
    [c(14, S), c(14, H), c(13, D), c(13, C), c(12, S)],
  ];
  let ok = true;
  for (const b of boards) {
    const t = analyzeBoardTexture(b);
    if (t.wetness < 0 || t.wetness > 10 || !Number.isFinite(t.wetness)) {
      console.error(`  FAIL wetness ${t.wetness} on a ${b.length}-card board`); failures++; ok = false;
    }
  }
  if (ok) console.log('  PASS every board scores between 0 and 10');

  // A monotone connected board must be wetter than a paired rainbow one
  const wet = analyzeBoardTexture([c(9, S), c(10, S), c(11, S)]);
  const dry = analyzeBoardTexture([c(2, C), c(2, D), c(7, H)]);
  expectTrue('connected monotone beats paired rainbow for wetness',
    wet.wetness > dry.wetness, `${wet.wetness} vs ${dry.wetness}`);
}

console.log('\nblockers are counted once per hand, not once per card');
{
  // Pocket kings on a king-high board: one blocker, not two
  const pair = analyzeBlockers([c(13, S), c(13, H)], [c(13, D), c(9, C), c(2, S)]);
  const topPairNotes = pair.notes.filter(n => n.includes('top pair combos')).length;
  expect('the note appears once', topPairNotes, 1);

  const single = analyzeBlockers([c(13, S), c(4, H)], [c(13, D), c(9, C), c(2, S)]);
  expect('a single matching card scores the same', pair.blocksTopPair, single.blocksTopPair);
}

console.log('\nthe board alone never breaks the classifier');
{
  // Playing the board entirely — our cards contribute nothing
  const nothing = classifyHandStrength(
    [c(3, S), c(2, H)], [c(14, D), c(13, C), c(12, S), c(11, H), c(9, C)],
  );
  expectTrue('junk against a big board is air or weak',
    nothing.relative === 'air' || nothing.relative === 'weak', nothing.relative);

  // Trips entirely on the board is not our hand
  const boardTrips = classifyHandStrength(
    [c(3, S), c(2, H)], [c(9, D), c(9, C), c(9, S), c(5, H), c(4, C)],
  );
  expectTrue('board trips with junk is not strong',
    boardTrips.relative !== 'strong' && boardTrips.relative !== 'nuts', boardTrips.relative);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall board and strength tests passed');
