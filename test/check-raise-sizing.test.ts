/**
 * `CheckRaiseDecision.sizing` is a multiple of THEIR bet, not a fraction of
 * the pot — the advisor applies it as `costToCall * sizing`. The interface
 * documented it as a pot fraction, which reads as a much smaller number.
 * Anyone retuning it on that basis would have shrunk check-raises to a third
 * of a bet, which is not even a legal raise.
 *
 * The comment is now correct; this pins the convention so it cannot drift
 * back silently.
 */
import { evaluateCheckRaise } from '../src/engine/postflop/check-raise';
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (r: number, s: number): Card =>
  ({ rank: r as Card['rank'], suit: s as Card['suit'] });

const BOARD = [c(12, 1), c(9, 0), c(4, 2)];
const TEXTURE = analyzeBoardTexture(BOARD);
const BLOCKERS: any = { blocksNutFlush: false, blocksStraight: false, bluffValueBoost: 0 };
const NUTS: any = { relative: 'nuts', drawStrength: 0, madeHand: 7, category: 'set' };

const COST_TO_CALL = 50;
const POT = 300;

const state: GameState = {
  holeCards: [c(9, 1), c(9, 2)], communityCards: BOARD,
  street: 'flop', pot: POT, yourStack: 5000, yourCurrentBet: 0,
  costToCall: COST_TO_CALL, minRaise: 100, bigBlind: 20, smallBlind: 10,
  players: [
    { name: 'you', seatIndex: 0, stack: 5000, currentBet: 0, isActive: true, isYou: true },
    { name: 'v', seatIndex: 1, stack: 5000, currentBet: COST_TO_CALL, isActive: true, isYou: false },
  ],
  activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
  availableActions: ['fold', 'call', 'raise'],
} as GameState;

console.log('sizing is a multiple of their bet');
{
  const d = evaluateCheckRaise(state, TEXTURE, NUTS, BLOCKERS);
  expect('a value check-raise is recommended', d.shouldCheckRaise, true);
  expect('sizing is greater than 1 — it is a multiplier', d.sizing > 1, true);

  // This is exactly what the advisor does with it
  const amount = Math.round(COST_TO_CALL * d.sizing);
  expect('applied to their bet, it exceeds the minimum raise', amount > state.minRaise, true);

  // If it were read as a fraction of the pot it would be absurd
  const asPotFraction = Math.round(POT * d.sizing);
  expect('reading it as a pot fraction would overbet wildly',
    asPotFraction > state.pot * 2, true);
}

console.log('the raise is always legal and affordable');
{
  for (const cost of [20, 50, 200, 1000]) {
    const s = { ...state, costToCall: cost, minRaise: cost * 2 };
    s.players = state.players.map(p => p.isYou ? p : { ...p, currentBet: cost });
    const d = evaluateCheckRaise(s as GameState, TEXTURE, NUTS, BLOCKERS);
    if (!d.shouldCheckRaise) continue;
    const amount = Math.round(cost * d.sizing);
    if (amount < s.minRaise) {
      console.error(`  FAIL raise ${amount} below min ${s.minRaise} at cost ${cost}`);
      failures++;
    }
  }
  console.log('  PASS every bet size produces a legal raise');
}

process.exit(failures > 0 ? 1 : 0);
