/**
 * E2: a strong hand facing a bet must be priced, not waved through.
 *
 * The strong-hand branch raised above 55% equity and otherwise called
 * UNCONDITIONALLY, printing "Equity X% supports a call" whatever X was.
 * Reproduced: a set of deuces on a four-to-a-straight river, facing a 2x-pot
 * bet, 26% equity against 40% pot odds — CALL.
 */
import { advisePostflopAction } from '../src/engine/postflop/postflop-advisor';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const SUIT: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };
const RANK: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const card = (t: string): Card => ({ rank: RANK[t[0]] as any, suit: SUIT[t[1]] as any });

function river(hole: [string, string], board: string[], potBefore: number, bet: number): GameState {
  const stack = 20000;
  return {
    holeCards: [card(hole[0]), card(hole[1])], communityCards: board.map(card), street: 'river',
    pot: potBefore + bet, yourStack: stack, yourCurrentBet: 0, costToCall: bet,
    minRaise: bet * 2, bigBlind: 100, smallBlind: 50,
    players: [
      { name: 'you', seatIndex: 0, stack, currentBet: 0, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: stack - bet, currentBet: bet, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

const SCARY = ['9c', 'Td', 'Jh', 'Qs', '2c'];  // any 8 or K is a straight

console.log('a strong hand facing a bet it cannot afford folds');
{
  const a = advisePostflopAction(river(['2s', '2d'], SCARY, 500, 1000));
  check('the hand is classified strong', a.handStrength.relative === 'strong',
    `got ${a.handStrength.relative} — test premise broken`);
  check('it folds', a.action === 'fold',
    `advised ${a.action} at ${Math.round(a.equity)}% equity vs ${Math.round(a.potOdds)}% odds`);
  check('and never claims the equity supports a call',
    !a.reasoning.some(r => /supports a call/i.test(r)));
}

console.log('but the same hand at a good price still calls');
{
  // A tenth-of-pot bet needs about 8% — even a scared set clears that easily
  const a = advisePostflopAction(river(['2s', '2d'], SCARY, 500, 50));
  check('it does not fold a cheap bet', a.action !== 'fold',
    `folded with ${Math.round(a.equity)}% equity needing ${Math.round(a.potOdds)}%`);
}

console.log('the decision never contradicts its own numbers');
{
  for (const bet of [50, 150, 300, 500, 750, 1000, 1500]) {
    const a = advisePostflopAction(river(['2s', '2d'], SCARY, 500, bet));
    // River: no realisation discount and no implied odds, so the displayed
    // equity and pot odds are exactly what the call is priced on.
    const contradicts = a.action === 'call' && a.equity + 0.5 < a.potOdds;
    check(`bet ${bet}: no call below the price`, !contradicts,
      `called at ${a.equity.toFixed(1)}% vs ${a.potOdds.toFixed(1)}%`);
  }
}

if (failures > 0) { console.error(`\n${failures} strong-hand test(s) failed`); process.exit(1); }
console.log('\nall strong-hand tests passed');
