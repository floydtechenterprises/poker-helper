/**
 * Preflop, a posted blind is not a bet.
 *
 * On the button with nothing raised, his big blind leaves half a blind to
 * call, and `estimateOpponentRange` treated anything to call as a raise. As a
 * bet it is 1bb into a 0.5bb pot — a 2x-pot overbet — so he was modelled as
 * the top 20% of hands. K4o on an unopened button was shown 32.6% equity
 * against a true 52.3%, and 143 of 169 hands were more than 8 points off.
 *
 * The same pot-fraction rule made every preflop open an "overbet", since the
 * preflop pot is only the blinds.
 *
 * That number is not just displayed: the learning engine grades decisions on
 * it, and only 20 of 156 button opens landed in its thin-value bucket.
 */
import { estimateOpponentRange, estimateOpponentSpec, calculateEquity } from '../src/engine/equity/monte-carlo';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

function spot(ours: number, theirs: number, board: Card[] = [], pot?: number): GameState {
  return {
    holeCards: [c(13, 0), c(4, 1)], communityCards: board,
    street: ({ 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' } as any)[board.length],
    pot: pot ?? ours + theirs, yourStack: 10000 - ours, yourCurrentBet: ours,
    costToCall: Math.max(0, theirs - ours), minRaise: BB * 2, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: 10000 - ours, currentBet: ours, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 10000 - theirs, currentBet: theirs, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

console.log('the unopened button faces a random hand');
{
  const unopened = spot(BB / 2, BB);
  check('his range is not narrowed by a forced blind', estimateOpponentRange(unopened) === 1,
    `modelled as the top ${(estimateOpponentRange(unopened) * 100).toFixed(0)}%`);

  const shown = calculateEquity(unopened.holeCards, [], 1, 40000, estimateOpponentSpec(unopened)).equity;
  const random = calculateEquity(unopened.holeCards, [], 1, 40000).equity;
  check(`K4o is shown its real equity (${(shown * 100).toFixed(1)}% vs ${(random * 100).toFixed(1)}%)`,
    Math.abs(shown - random) < 0.02, 'was 32.6% against a true 52.3%');

  check('a limp in the big blind is unchanged', estimateOpponentRange(spot(BB, BB)) === 1);
}

console.log('a real raise still narrows him');
{
  const open = estimateOpponentRange(spot(BB, BB * 2.5));
  check('facing a 2.5bb open', open < 1, `range ${open}`);
  check('at the preflop base, not an "overbet"', Math.abs(open - 0.35) < 1e-9,
    `a standard open scored ${(open * 100).toFixed(0)}% — read as a 2.5x-pot overbet`);
  check('a 3-bet counts as a raise too', estimateOpponentRange(spot(BB * 2.5, BB * 8)) < 1);
}

console.log('postflop sizing still means something');
{
  const flop = [c(10, 2), c(5, 3), c(2, 1)];
  const small = estimateOpponentRange(spot(0, 300, flop, 1000 + 300));
  const big = estimateOpponentRange(spot(0, 1500, flop, 1000 + 1500));
  check('an overbet narrows him more than a small bet', big < small, `small ${small}, overbet ${big}`);
}

console.log(failures > 0 ? `\n${failures} blind test(s) failed` : '\nall blind tests passed');
process.exit(failures > 0 ? 1 : 0);
