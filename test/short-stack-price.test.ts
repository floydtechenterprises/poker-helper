/**
 * You can never pay more than your stack.
 *
 * When a bet is bigger than what you have behind, the excess is returned to
 * the bettor and never contests the pot. The engine used to price the full
 * bet, which overstated the call and folded hands that were clearly +EV:
 * an 8,701 shove into a 3,000 stack priced as 41% when the truth is 30%.
 */
import { effectiveCallPrice } from '../src/engine/pot-odds';
import { StrategyEngine } from '../src/engine';
import { GameState, Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectClose(name: string, actual: number, expected: number, tol = 0.005): void {
  if (Math.abs(actual - expected) <= tol) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ~${expected}, got ${actual}`); failures++; }
}

const c = (rank: number, suit: number): Card =>
  ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

console.log('effectiveCallPrice');
{
  // Covered call: nothing is returned, so the price is unchanged
  const full = effectiveCallPrice(12701, 6701, 7299);
  expect('pays the whole bet when we can cover it', full.toCall, 6701);
  expectClose('and prices it normally', full.price, 6701 / (12701 + 6701));

  // Short call: 5,701 of the 8,701 goes straight back to them
  const short = effectiveCallPrice(12701, 8701, 3000);
  expect('caps what we pay at our stack', short.toCall, 3000);
  expect('and removes the overlay from the pot', short.contestedPot, 7000);
  expectClose('giving the real price, not the button price', short.price, 3000 / 10000);
}
{
  const zero = effectiveCallPrice(0, 0, 0);
  expectClose('degenerate all-zero case is 0, not NaN', zero.price, 0);
  const broke = effectiveCallPrice(500, 200, 0);
  expect('no chips means nothing to pay', broke.toCall, 0);
}

console.log('a bet bigger than we can match is partly returned to them');
{
  /**
   * From a real hand: he shoved 11,100 into our 5,300 with 14,700 in the pot.
   *
   * PokerNow's call button already reads "ALL IN 5300", so costToCall is
   * capped before we ever see it and the first overlay rule finds nothing
   * wrong. But 5,800 of his bet can never be matched and comes straight
   * back to him. The engine priced that call at 27% when the truth was 37%
   * — a ten-point error, always in the direction of calling.
   */
  const blind = effectiveCallPrice(14700, 5300, 5300);
  expectClose('not knowing their bet understates the price', blind.price, 5300 / 20000);

  const seen = effectiveCallPrice(14700, 5300, 5300, 11100, 0);
  expect('their uncallable excess leaves the pot', seen.contestedPot, 8900);
  expectClose('giving the true price', seen.price, 5300 / 14200);
  expect('we still pay our whole stack', seen.toCall, 5300);
}

console.log('a bet we can cover is left alone');
{
  const covered = effectiveCallPrice(3000, 1000, 5000, 1000, 0);
  expect('nothing is returned', covered.contestedPot, 3000);
  expectClose('so the price is unchanged', covered.price, 1000 / 4000);

  // Chips already in front of us count toward what we can match. Their
  // 1000 total against our 900 out plus 100 behind is exactly coverable, so
  // nothing is returned — and the cost to call is the 100 difference, not
  // their whole wager.
  const withBet = effectiveCallPrice(3000, 100, 100, 1000, 900);
  expect('our own committed chips are not ignored', withBet.contestedPot, 3000);
  expectClose('and the price uses only what we still owe', withBet.price, 100 / 3100);
}

console.log('the engine acts on the real price');
{
  // 40% equity against a true 30% price is a clear call; it folded before.
  const state: GameState = {
    holeCards: [c(6, 0), c(8, 0)],
    communityCards: [c(12, 1), c(9, 0), c(4, 2), c(11, 0)],
    street: 'turn',
    pot: 12701, yourStack: 3000, yourCurrentBet: 0, costToCall: 8701,
    minRaise: 0, bigBlind: 1000, smallBlind: 500,
    players: [
      { name: 'you', seatIndex: 0, stack: 3000, currentBet: 0, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 0, currentBet: 8701, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call'],
    precomputedEquity: 0.40,
  };

  new StrategyEngine().evaluate(state).then(a => {
    expect('calls a 40% hand against a 30% price', a.action, 'call');
    const quoted = a.potOdds;
    expectClose('and quotes the capped price, not the button price', quoted, 30, 1.5);
    const explains = a.reasoning.some(r => r.includes('the rest of their bet is returned'));
    expect('explains why the price is lower than the button', explains, true);
    process.exit(failures > 0 ? 1 : 0);
  });
}
