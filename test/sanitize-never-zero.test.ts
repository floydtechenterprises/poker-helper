/**
 * "BET 0" must never reach the screen.
 *
 * `sanitizeAmount` says so in its own comment and guarded the case it had
 * seen — a stack read as zero. It did not guard the other route to the same
 * output: every term of the minimum can be zero at once.
 *
 *   - an unreadable big blind parses as 0 (the health check flags it, but
 *     the engine still runs)
 *   - `minRaise` is usually 0, because PokerNow renders the raise input only
 *     after you click RAISE
 *   - with nothing to call, the rule minimum is just the big blind
 *
 * The floor was then 0, and an advisor amount of 0 passed straight through.
 * Found by fuzzing 100,000 spots, not by reading.
 */
import { sanitizeAmount } from '../src/engine';
import { Advice, GameState, Card, ActionType } from '../src/engine/types';

let failures = 0;
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function spot(over: Partial<GameState>): GameState {
  return {
    holeCards: [c(14, 0), c(13, 1)], communityCards: [], street: 'flop',
    pot: 500, yourStack: 4000, yourCurrentBet: 0, costToCall: 0,
    minRaise: 0, bigBlind: 100, smallBlind: 50,
    activePlayers: 2, position: 'BTN', dealerSeatIndex: 0,
    availableActions: ['fold', 'check', 'call', 'bet', 'raise'] as ActionType[],
    players: [
      { name: 'You', seatIndex: 0, stack: 4000, currentBet: 0, isYou: true, isActive: true },
      { name: 'V', seatIndex: 1, stack: 4000, currentBet: 0, isYou: false, isActive: true },
    ],
    ...over,
  } as unknown as GameState;
}

function advice(amount: number | undefined, action: ActionType = 'bet'): Advice {
  return {
    action, amount, confidence: 60, equity: 50, potOdds: 30,
    handStrength: { category: 'x', madeHand: 1, drawStrength: 0, relative: 'medium' },
    boardTexture: {} as Advice['boardTexture'], reasoning: [], alternatives: [],
  };
}

console.log('\nno combination of zeroes produces a zero bet');
{
  // Everything that feeds the minimum, all zero at once
  const r = sanitizeAmount(advice(0), spot({ bigBlind: 0, minRaise: 0, costToCall: 0 }));
  expectTrue('a bet of zero is impossible',
    r.action !== 'bet' || (r.amount !== undefined && r.amount > 0), `${r.action} ${r.amount}`);

  const r2 = sanitizeAmount(advice(0), spot({ bigBlind: 0, minRaise: 0, costToCall: 300 }));
  expectTrue('and facing a bet too',
    r2.action !== 'raise' || (r2.amount !== undefined && r2.amount > 0), `${r2.action} ${r2.amount}`);
}

console.log('\nhaving no chips still downgrades rather than betting nothing');
{
  const r = sanitizeAmount(advice(500), spot({ yourStack: 0, yourCurrentBet: 0 }));
  expectTrue('the action becomes passive', r.action !== 'bet' && r.action !== 'raise', r.action);
  expectTrue('with no amount attached', r.amount === undefined);
}

console.log('\nnormal sizing is untouched');
{
  const r = sanitizeAmount(advice(350), spot({}));
  expectTrue('a sensible bet survives', r.amount !== undefined && r.amount >= 100, `${r.amount}`);
  expectTrue('and stays within the stack', (r.amount ?? 0) <= 4000);
}

console.log('\nthe minimum is still respected when facing a raise');
{
  // Owe 300 on top of 200 already in; the minimum raise-to is 800
  const r = sanitizeAmount(advice(400), spot({
    costToCall: 300, yourCurrentBet: 200, bigBlind: 100, minRaise: 0,
  }));
  expectTrue('an undersized raise is lifted to legal',
    (r.amount ?? 0) >= 800, `${r.amount}`);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall sanitize tests passed');
