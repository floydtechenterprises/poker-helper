/**
 * The exact hand that prompted this: K♥9♥ on A♠Q♠6♠4♥2♥.
 *
 * The board's ace plays, so the real hand is A-K-Q-9-6 — ace high with the
 * second-best kicker, which beats every busted draw. It was labelled
 * "King high" and classified as air, which is why calling looked absurd.
 */
import { classifyHandStrength } from '../src/engine/postflop/hand-strength';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectContains(name: string, actual: string, needle: string): void {
  if (actual.includes(needle)) console.log(`  PASS ${name} ("${actual}")`);
  else { console.error(`  FAIL ${name}: "${actual}" lacks "${needle}"`); failures++; }
}

const c = (rank: number, suit: number): Card =>
  ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

// A♠ Q♠ 6♠ 4♥ 2♥
const BOARD = [c(14, 3), c(12, 3), c(6, 3), c(4, 2), c(2, 2)];

console.log('the hand from the screenshot');
{
  const h = classifyHandStrength([c(13, 2), c(9, 2)], BOARD); // K♥9♥
  expectContains('named as ace high, not king high', h.category, 'Ace high');
  expectContains('and states the kicker that makes it', h.category, 'King');
  expect('classified as a bluff-catcher, not air', h.relative, 'weak');
}

console.log('genuinely worthless hands stay air');
{
  // 8♦7♦ — best five is A-Q-8-7-6, our cards are the 4th and 5th card
  const h = classifyHandStrength([c(8, 1), c(7, 1)], BOARD);
  expect('low cards behind the board are air', h.relative, 'air');
}
{
  // Needs a board where our cards cannot reach the best five at all.
  // (5♦3♦ on THIS board makes 2-3-4-5-6 — a straight, not air.)
  const boardPlays = [c(14, 3), c(13, 3), c(12, 0), c(11, 1), c(9, 2)];
  const h = classifyHandStrength([c(3, 1), c(2, 1)], boardPlays);
  expect('playing the board is air', h.relative, 'air');
  expectContains('and says so plainly', h.category, 'playing the board');
}

console.log('a better kicker is still a bluff-catcher');
{
  // K beats J as the kicker behind the board's ace
  const withKing = classifyHandStrength([c(13, 2), c(9, 2)], BOARD);
  const withJack = classifyHandStrength([c(11, 2), c(9, 2)], BOARD);
  expect('king kicker rides as the second card — playable', withKing.relative, 'weak');
  // A-Q-J-9-6: the jack is only the third card, so it beats far less.
  // Treating it the same as the king version would be too loose.
  expect('jack kicker is third card — not a bluff-catcher', withJack.relative, 'air');
}

console.log('holding the ace ourselves reads correctly');
{
  const h = classifyHandStrength([c(14, 1), c(9, 1)], [c(13, 3), c(8, 3), c(3, 0), c(4, 2), c(2, 2)]);
  expectContains('ace high named', h.category, 'Ace high');
  expect('and is a bluff-catcher', h.relative, 'weak');
}

console.log('pairs and better are unaffected');
{
  const pair = classifyHandStrength([c(12, 1), c(9, 1)], BOARD); // pairs the queen
  expect('a pair is not high-card', pair.relative === 'air', false);
}

process.exit(failures > 0 ? 1 : 0);
