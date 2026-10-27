/**
 * N1: weak made hands are priced, not cut off at an arbitrary line.
 *
 * The branch called only when the price was at most 20% AND equity at least
 * 30%, folding everything else as "Equity X% doesn't justify calling" whatever
 * X was. Found by the E6 real-equity sweep; reproduced as pocket nines on
 * T-5-4 at 44% equity needing 21% — FOLD.
 *
 * Priced deliberately stricter than other branches: realised equity against
 * the RAW price, with no implied-odds credit, because weak hands that are
 * behind lose more on later streets rather than winning more.
 */
import { advisePostflopAction } from '../src/engine/postflop/postflop-advisor';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const S: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };
const RK: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const card = (t: string): Card => ({ rank: RK[t[0]] as any, suit: S[t[1]] as any });

function spot(hole: [string, string], board: string[], potBefore: number, bet: number, equity?: number): GameState {
  const stack = 20000;
  return {
    holeCards: [card(hole[0]), card(hole[1])], communityCards: board.map(card),
    street: ({ 3: 'flop', 4: 'turn', 5: 'river' } as any)[board.length],
    pot: potBefore + bet, yourStack: stack, yourCurrentBet: 0, costToCall: bet, minRaise: bet * 2,
    bigBlind: 20, smallBlind: 10, precomputedEquity: equity,
    players: [
      { name: 'you', seatIndex: 0, stack, currentBet: 0, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack, currentBet: bet, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

console.log('a priced-in weak made hand calls');
{
  const a = advisePostflopAction(spot(['9s', '9c'], ['Td', '5c', '4d'], 700, 300));
  check('99 on T-5-4 calls a 23% price', a.action === 'call',
    `${a.action} at ${a.equity.toFixed(1)}% vs ${a.potOdds.toFixed(1)}%`);
  check('and never claims its equity fails to justify a call',
    !a.reasoning.some(r => /doesn't justify/i.test(r)));
}

console.log('but not one it cannot afford');
{
  const a = advisePostflopAction(spot(['9s', '9c'], ['Td', '5c', '4d'], 500, 1000));
  check('99 folds a 2x-pot bet', a.action === 'fold',
    `${a.action} at ${a.equity.toFixed(1)}% vs ${a.potOdds.toFixed(1)}%`);
}

console.log('and air still folds');
{
  const a = advisePostflopAction(spot(['7h', '2c'], ['Ad', 'Ks', 'Qh'], 700, 300));
  check('72o on A-K-Q folds', a.action === 'fold');
}

console.log('no implied-odds credit: priced on the raw price');
{
  // Equity pinned just below the raw price but above what implied odds would
  // allow — the weak branch must fold, where a draw branch would call.
  const st = spot(['9s', '9c'], ['Td', '5c', '4d'], 700, 300, 0.235);
  const a = advisePostflopAction(st);
  const raw = 300 / 1300;
  check('equity above the implied price but below the raw one folds', a.action === 'fold',
    `raw price ${(raw * 100).toFixed(1)}%, chose ${a.action}`);
  check('and it displays the raw price it compared', Math.abs(a.potOdds - raw * 100) < 0.6,
    `displayed ${a.potOdds.toFixed(1)}%`);
}

/**
 * N2, which turned out to be N1.
 *
 * The audit sweep reported top pair folding at ~60% equity with blocker notes
 * as its reasoning, and it was logged as a blocker-logic bug. It was not:
 * top pair with a weak kicker classifies as 'weak', so it took the same
 * unpriced branch, and the blocker notes are simply pushed onto the reasoning
 * first. Proven by reverting N1 — all four spots below folded at 60-67%
 * equity — and restoring it, when all four call.
 */
console.log('top pair with a weak kicker is not folded to a small bet (N2)');
for (const [label, h, b] of [
  ['K8 on 3-7-K-5', ['8s', 'Ks'], ['3s', '7h', 'Kc', '5h']],
  ['A5 on Q-K-A-2-6', ['5h', 'Ah'], ['Qd', 'Kc', 'Ad', '2d', '6h']],
] as [string, [string, string], string[]][]) {
  const a = advisePostflopAction(spot(h, b, 700, 300));
  check(`${label} calls a 23% price`, a.action === 'call',
    `${a.action} at ${a.equity.toFixed(1)}% vs ${a.potOdds.toFixed(1)}%`);
}

if (failures > 0) { console.error(`\n${failures} weak-hand test(s) failed`); process.exit(1); }
console.log('\nall weak-hand tests passed');
