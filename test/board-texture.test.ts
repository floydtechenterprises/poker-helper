/**
 * A draw needs a card still to come.
 *
 * `straightDraw` fired on 72% of five-card boards, where nothing can improve
 * any more. That inflated `wetness`, which drives barrel sizing and c-bet
 * frequency on precisely the street where the hand is already decided.
 *
 * Killing it exposed a second gap: four to a straight on a finished board is
 * neither a draw nor a straight on the board, so with the bogus draw flag
 * gone, 9-T-J-Q-x would have read as dry — despite any opponent holding a
 * king or an eight already having a straight.
 */
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { createDeck } from '../src/engine/cards';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (r: number, s: number): Card =>
  ({ rank: r as Card['rank'], suit: s as Card['suit'] });

console.log('no board with five cards is ever "drawing"');
{
  const deck = createDeck();
  let riverDraws = 0; let turnDraws = 0; const N = 2000;
  for (let i = 0; i < N; i++) {
    const pick: Card[] = []; const used = new Set<number>();
    while (pick.length < 5) {
      const k = Math.floor(Math.random() * 52);
      if (!used.has(k)) { used.add(k); pick.push(deck[k]); }
    }
    if (analyzeBoardTexture(pick).straightDraw) riverDraws++;
    if (analyzeBoardTexture(pick.slice(0, 4)).straightDraw) turnDraws++;
  }
  expect('zero of 2000 complete boards claim a straight draw', riverDraws, 0);
  expect('turns still find draws (they are live)', turnDraws > 0, true);
}

console.log('live draws are untouched');
{
  const turn = analyzeBoardTexture([c(9, 0), c(10, 1), c(11, 2), c(2, 3)]);
  expect('9-T-J-2 on the turn is an open-ender', turn.straightDraw, true);

  const flop = analyzeBoardTexture([c(9, 0), c(10, 1), c(11, 2)]);
  expect('9-T-J on the flop is a draw', flop.straightDraw, true);
}

console.log('a finished board that a single card completes is still dangerous');
{
  const river = analyzeBoardTexture([c(9, 0), c(10, 1), c(11, 2), c(12, 3), c(2, 0)]);
  expect('9-T-J-Q-2 is not a draw', river.straightDraw, false);
  expect('and there is no straight ON the board', river.straightComplete, false);
  expect('but it is not read as dry', river.wetness >= 4, true);
  expect('and it says why', river.summary.includes('four to a straight'), true);
}

console.log('a straight actually on the board still reads that way');
{
  const made = analyzeBoardTexture([c(9, 0), c(10, 1), c(11, 2), c(12, 3), c(13, 0)]);
  expect('9-T-J-Q-K is a straight on board', made.straightComplete, true);
  expect('not merely "one card makes it"',
    made.summary.includes('straight on board'), true);
}

console.log('the wheel is handled at both ends');
{
  const wheel = analyzeBoardTexture([c(14, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0)]);
  expect('A-2-3-4-5 is a straight on board', wheel.straightComplete, true);

  const wheelDraw = analyzeBoardTexture([c(14, 0), c(2, 1), c(3, 2)]);
  expect('A-2-3 on the flop is drawing', wheelDraw.straightDraw, true);
}

console.log('nothing produces a nonsense texture');
{
  const deck = createDeck();
  let bad = 0;
  for (let i = 0; i < 1500; i++) {
    const size = [0, 1, 2, 3, 4, 5][Math.floor(Math.random() * 6)];
    const pick: Card[] = []; const used = new Set<number>();
    while (pick.length < size) {
      const k = Math.floor(Math.random() * 52);
      if (!used.has(k)) { used.add(k); pick.push(deck[k]); }
    }
    const t = analyzeBoardTexture(pick);
    if (!Number.isFinite(t.wetness) || t.wetness < 0 || t.wetness > 10) bad++;
    if (typeof t.summary !== 'string' || t.summary.length === 0) bad++;
    // A draw and a made straight are mutually exclusive claims
    if (t.straightDraw && t.straightComplete) bad++;
  }
  expect('1500 random boards all sane', bad, 0);
}

console.log('two of a suit is a flush draw, three is a flush possible');
{
  /**
   * Both thresholds were one suit too high: a draw at three, "complete" at
   * four. Two-tone flops — 55% of all flops — had no flush draw, so Kh 7h 2c
   * read "Dry board" at wetness 0 and 88% of two-tone flops read as dry.
   */
  const twoTone = analyzeBoardTexture([c(13, 1), c(7, 1), c(2, 3)]);
  expect('Kh 7h 2c has a flush draw', twoTone.flushDraw, true);
  expect('but no flush yet', twoTone.flushComplete, false);
  expect('and is not scored bone dry', twoTone.wetness >= 3, true);

  const rainbow = analyzeBoardTexture([c(13, 1), c(7, 2), c(2, 3)]);
  expect('the rainbow version has no draw', rainbow.flushDraw, false);
  expect('and is drier than the two-tone one', rainbow.wetness < twoTone.wetness, true);

  // The turn that brings the third heart is exactly when barreling must
  // notice a completed flush — it previously needed a fourth
  const thirdHeart = analyzeBoardTexture([c(13, 1), c(7, 1), c(2, 3), c(9, 1)]);
  expect('a third heart on the turn completes the flush', thirdHeart.flushComplete, true);

  const twoToneRiver = analyzeBoardTexture([c(13, 1), c(7, 1), c(2, 3), c(9, 0), c(4, 2)]);
  expect('two of a suit on the river is no draw', twoToneRiver.flushDraw, false);
}

console.log('rivers score exactly as before');
{
  // The correction is to the streets with cards still to come. On a finished
  // board nothing is drawing, and these are the values the old thresholds
  // produced, captured before the change.
  const r = (cards: Card[]) => analyzeBoardTexture(cards).wetness;
  expect('two hearts on the river', r([c(13, 1), c(7, 1), c(2, 3), c(9, 0), c(4, 2)]), 2);
  expect('three hearts on the river', r([c(13, 1), c(7, 1), c(2, 1), c(9, 0), c(4, 2)]), 5);
  expect('four hearts on the river', r([c(13, 1), c(7, 1), c(2, 1), c(9, 1), c(4, 2)]), 6);
  expect('five hearts on the river', r([c(11, 1), c(10, 1), c(9, 1), c(8, 1), c(2, 1)]), 10);

  const deck = createDeck();
  let wrong = 0;
  for (let i = 0; i < 3000; i++) {
    const d = [...deck];
    for (let k = 0; k < 5; k++) {
      const j = k + ((i * 7919 + k * 104729) % (d.length - k));
      [d[k], d[j]] = [d[j], d[k]];
    }
    const counts = [0, 0, 0, 0];
    for (const x of d.slice(0, 5)) counts[x.suit]++;
    const t = analyzeBoardTexture(d.slice(0, 5));
    if (t.flushDraw || t.flushComplete !== Math.max(...counts) >= 3) wrong++;
  }
  expect('3000 rivers: never a draw, flush flagged exactly at three of a suit', wrong, 0);
}

process.exit(failures > 0 ? 1 : 0);
