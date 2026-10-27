/**
 * Every postflop module must agree on who has position.
 *
 * The advisor was fixed to compute acting order rather than read the preflop
 * label, and three other modules were never updated: `cbet.ts` lost 15 points
 * of c-bet score on every heads-up hand, `check-raise.ts` let the button plan
 * check-raises it can never execute, and `float-play.ts` refused to float at
 * all — the play was dead in the only format that matters here.
 *
 * Each was a separate one-line copy of the same wrong idea, which is exactly
 * why this tests the modules rather than the helper.
 */
import { heroHasPosition } from '../src/engine/position';
import { evaluateCbet } from '../src/engine/postflop/cbet';
import { evaluateCheckRaise } from '../src/engine/postflop/check-raise';
import { evaluateFloat } from '../src/engine/postflop/float-play';
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { analyzeBlockers } from '../src/engine/postflop/blockers';
import { GameState, Card, Rank, Suit, HandStrength } from '../src/engine/types';

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
const BOARD = [c(9, 0), c(4, 1), c(2, 2)];   // dry, disconnected

/** Heads-up. `heroIsButton` decides which seat we occupy. */
function headsUp(heroIsButton: boolean, over: Partial<GameState> = {}): GameState {
  return {
    holeCards: [c(14, 3), c(13, 3)],
    communityCards: BOARD,
    street: 'flop',
    pot: 200, yourStack: 4000, yourCurrentBet: 0,
    costToCall: 0, minRaise: 0, bigBlind: 20, smallBlind: 10,
    activePlayers: 2,
    // Dealer sits in seat 0. Heads-up the dealer acts LAST after the flop.
    dealerSeatIndex: 0,
    position: heroIsButton ? 'SB' : 'BB',
    availableActions: ['check', 'bet'],
    players: [
      { name: heroIsButton ? 'You' : 'Villain', seatIndex: 0, stack: 4000, currentBet: 0, isYou: heroIsButton, isActive: true },
      { name: heroIsButton ? 'Villain' : 'You', seatIndex: 1, stack: 4000, currentBet: 0, isYou: !heroIsButton, isActive: true },
    ],
    ...over,
  } as unknown as GameState;
}

const airHand: HandStrength = { category: 'Ace high', madeHand: 0, drawStrength: 0, relative: 'air' };
const strongHand: HandStrength = { category: 'Set', madeHand: 3, drawStrength: 0, relative: 'nuts' };

console.log('\nheads-up, the button has position after the flop');
{
  expect('the dealer acts last', heroHasPosition(headsUp(true)), true);
  expect('the other seat does not', heroHasPosition(headsUp(false)), false);
}

console.log('\nc-bet scoring reflects real position, not the preflop label');
{
  const texture = analyzeBoardTexture(BOARD);
  const ip = evaluateCbet(headsUp(true), texture, airHand, true);
  const oop = evaluateCbet(headsUp(false), texture, airHand, true);
  expectTrue('in position scores higher than out of position',
    ip.confidence > oop.confidence, `${ip.confidence} vs ${oop.confidence}`);
}

console.log('\ncheck-raises are an out-of-position play only');
{
  const texture = analyzeBoardTexture(BOARD);
  const blockers = analyzeBlockers([c(14, 3), c(13, 3)], BOARD);
  const fromButton = evaluateCheckRaise(headsUp(true), texture, strongHand, blockers);
  const fromBigBlind = evaluateCheckRaise(headsUp(false), texture, strongHand, blockers);

  expect('the button never plans a check-raise', fromButton.shouldCheckRaise, false);
  expectTrue('the out-of-position seat can', fromBigBlind.shouldCheckRaise);
}

console.log('\nfloating requires position and is alive heads-up');
{
  const facing = { costToCall: 100, pot: 300, availableActions: ['fold', 'call', 'raise'] };
  const texture = analyzeBoardTexture(BOARD);

  const ip = evaluateFloat(headsUp(true, facing as Partial<GameState>), texture, airHand);
  const oop = evaluateFloat(headsUp(false, facing as Partial<GameState>), texture, airHand);

  expectTrue('out of position never floats', !oop.shouldFloat);
  expectTrue('in position it is at least considered',
    ip.reasoning !== "Can't float out of position", ip.reasoning);
}

console.log('\nno module reads position from the preflop label any more');
{
  /**
   * Multiway folding to two: labels come from who was DEALT IN and never
   * change, so a CO and a BB survive to the flop. The CO plainly acts last
   * and no label says so.
   */
  const state = headsUp(false, {
    position: 'CO',
    dealerSeatIndex: 5,
    players: [
      { name: 'You', seatIndex: 4, stack: 4000, currentBet: 0, isYou: true, isActive: true },
      { name: 'Villain', seatIndex: 2, stack: 4000, currentBet: 0, isYou: false, isActive: true },
    ],
  } as Partial<GameState>);
  expect('the later seat has position despite the stale label',
    heroHasPosition(state), true);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall position propagation tests passed');
