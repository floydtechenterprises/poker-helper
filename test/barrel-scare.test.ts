/**
 * Scare cards are measured against the board as it WAS.
 *
 * `boardTexture.highCard` is computed over the whole board including the card
 * that just landed, so `turnCard.rank > boardTexture.highCard` compared a
 * card with itself and was never true. A queen arriving on 9-4-2 is about as
 * clear an overcard as exists and scored nothing — only the hard-coded
 * ace/king rule ever fired, and the "overcard hit" bonus was dead entirely.
 */
import { evaluateTurnBarrel, evaluateRiverBarrel } from '../src/engine/postflop/barreling';
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { analyzeBlockers } from '../src/engine/postflop/blockers';
import { Card, Rank, Suit, HandStrength } from '../src/engine/types';

let failures = 0;
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });
const FLOP = [c(9, 0), c(4, 1), c(2, 2)];
const draw: HandStrength = { category: 'Draw', madeHand: 0, drawStrength: 3, relative: 'weak' };

const flopHigh = Math.max(...FLOP.map(x => x.rank));

console.log('\na queen on a nine-high flop is an overcard');
{
  const turn = c(12, 3);
  const board = [...FLOP, turn];
  const texture = analyzeBoardTexture(board);
  const blockers = analyzeBlockers([c(14, 3), c(13, 3)], board);

  const scored = evaluateTurnBarrel(texture, draw, blockers, turn, 100, true, flopHigh);
  // Same call, but with the buggy comparison value (the board including the turn)
  const blind = evaluateTurnBarrel(texture, draw, blockers, turn, 100, true, texture.highCard);

  expectTrue('the overcard is recognised', scored.confidence > blind.confidence,
    `${scored.confidence} vs ${blind.confidence}`);
  expectTrue('and it is named in the reasoning',
    scored.reasoning.toLowerCase().includes('scare')
    || scored.reasoning.toLowerCase().includes('overcard'), scored.reasoning);
}

console.log('\na blank does not become a scare card');
{
  const turn = c(3, 3);   // lower than the flop's nine
  const board = [...FLOP, turn];
  const texture = analyzeBoardTexture(board);
  const blockers = analyzeBlockers([c(14, 3), c(13, 3)], board);
  const d = evaluateTurnBarrel(texture, draw, blockers, turn, 100, true, flopHigh);
  expectTrue('a three on nine-high is not scary',
    !d.reasoning.includes('scare card'), d.reasoning);
}

console.log('\naces and kings stay scary regardless');
{
  const turn = c(14, 3);
  const board = [...FLOP, turn];
  const texture = analyzeBoardTexture(board);
  const blockers = analyzeBlockers([c(13, 3), c(12, 3)], board);
  const d = evaluateTurnBarrel(texture, draw, blockers, turn, 100, true, flopHigh);
  expectTrue('an ace is a scare card', d.reasoning.includes('scare card'), d.reasoning);
}

console.log('\nthe river uses the turn board, not the full five');
{
  const board = [...FLOP, c(7, 3), c(11, 0)];   // jack river on a nine-high board
  const priorHigh = Math.max(...board.slice(0, 4).map(x => x.rank));
  const texture = analyzeBoardTexture(board);
  const blockers = analyzeBlockers([c(14, 3), c(13, 3)], board);

  const scored = evaluateRiverBarrel(texture, draw, blockers, c(11, 0), 100, true, false, priorHigh);
  const blind = evaluateRiverBarrel(texture, draw, blockers, c(11, 0), 100, true, false, texture.highCard);
  expectTrue('the jack registers as an overcard',
    scored.confidence > blind.confidence, `${scored.confidence} vs ${blind.confidence}`);
}

console.log('\nbarrels still require having bet the previous street');
{
  const board = [...FLOP, c(14, 3)];
  const texture = analyzeBoardTexture(board);
  const blockers = analyzeBlockers([c(13, 3), c(12, 3)], board);
  const d = evaluateTurnBarrel(texture, draw, blockers, c(14, 3), 100, false, flopHigh);
  expectTrue('no flop bet means no turn barrel', !d.shouldBarrel);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall barrel scare-card tests passed');
