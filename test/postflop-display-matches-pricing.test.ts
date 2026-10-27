/**
 * E6: the numbers shown beside a postflop call are the numbers it compared.
 *
 * Calls are decided on REALISED equity (discounted for position) against the
 * price after implied odds, but the panel showed RAW equity and RAW pot odds.
 * Reproduced, pot 250 facing 150 on the flop:
 *
 *   flush draw IP          CALL  28.0% vs 37.5%  "Getting the right price: pot odds 38% vs equity 28%"
 *   top pair T kicker IP   CALL  36.5% vs 37.5%
 *   same hand OOP          FOLD  39.5% vs 37.5%  "not getting the right price"
 *
 * Scope, stated plainly: this pins the branches that PRICE a call. A sweep
 * with real equity also found branches that decide on other grounds and so
 * still disagree with the price — float plays (deliberate: a float calls to
 * bluff later), the weak-hand fold rule, and blocker-based folds. The last
 * two are genuine decision bugs, tracked separately as N1 and N2, and are
 * deliberately NOT asserted as fixed here.
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

function flop(hole: [string, string], board: string[], equity: number, heroOnButton: boolean): GameState {
  const stack = 10000;
  return {
    holeCards: [card(hole[0]), card(hole[1])], communityCards: board.map(card), street: 'flop',
    pot: 250, yourStack: stack, yourCurrentBet: 0, costToCall: 150, minRaise: 300, bigBlind: 10, smallBlind: 5,
    precomputedEquity: equity,
    players: [
      { name: 'you', seatIndex: 0, stack, currentBet: 0, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: stack - 150, currentBet: 150, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: heroOnButton ? 'SB' : 'BB', dealerSeatIndex: heroOnButton ? 0 : 1,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

const contradicts = (a: { action: string; equity: number; potOdds: number }) =>
  (a.action === 'call' && a.equity + 0.5 < a.potOdds) || (a.action === 'fold' && a.equity > a.potOdds + 0.5);

console.log('the three reproduced spots no longer contradict themselves');
for (const [label, h, b, eq, ip, want] of [
  ['flush draw IP', ['9h', '8h'], ['Kh', '4h', '2c'], 0.28, true, 'call'],
  ['top pair T kicker IP', ['Kd', 'Tc'], ['Ks', '7h', '3d'], 0.365, true, 'call'],
  ['top pair T kicker OOP', ['Kd', 'Tc'], ['Ks', '7h', '3d'], 0.395, false, 'fold'],
] as [string, [string, string], string[], number, boolean, string][]) {
  const a = advisePostflopAction(flop(h, b, eq, ip));
  check(`${label}: still ${want}s`, a.action === want, `now ${a.action}`);
  check(`${label}: its numbers agree with it`, !contradicts(a),
    `${a.action} at ${a.equity.toFixed(1)}% vs ${a.potOdds.toFixed(1)}%`);
}

console.log('priced branches never argue against their own action');
{
  const PRICED = /this call needs|not getting the right price|\+EV call|Getting the right price/i;
  let priced = 0, bad = 0; const eg: string[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // REAL equity: the river combination guard overrides folds from actual card
  // counts, so fabricated equity would manufacture contradictions it rightly refutes
  for (let i = 0; i < 500; i++) {
    const d: Card[] = [];
    for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) d.push({ rank: r as any, suit: s as any });
    for (let k = d.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [d[k], d[j]] = [d[j], d[k]]; }
    const len = [3, 4, 5][Math.floor(rnd() * 3)];
    const potBefore = 50 + Math.floor(rnd() * 950), bet = Math.max(10, Math.floor(potBefore * (0.1 + rnd() * 1.9)));
    const stack = bet + Math.floor(rnd() * 20000), ip = rnd() < 0.5;
    const st = {
      holeCards: [d[0], d[1]], communityCards: d.slice(2, 2 + len),
      street: ({ 3: 'flop', 4: 'turn', 5: 'river' } as any)[len],
      pot: potBefore + bet, yourStack: stack, yourCurrentBet: 0, costToCall: bet, minRaise: bet * 2,
      bigBlind: 20, smallBlind: 10,
      players: [
        { name: 'you', seatIndex: 0, stack, currentBet: 0, isActive: true, isYou: true },
        { name: 'v', seatIndex: 1, stack, currentBet: bet, isActive: true, isYou: false },
      ],
      activePlayers: 2, position: ip ? 'SB' : 'BB', dealerSeatIndex: ip ? 0 : 1,
      availableActions: ['fold', 'call', 'raise'],
    } as GameState;
    const a = advisePostflopAction(st);
    if (!(a.action === 'call' || a.action === 'fold') || !a.reasoning.some(r => PRICED.test(r))) continue;
    priced++;
    if (contradicts(a)) { bad++; if (eg.length < 3) eg.push(`${a.action} ${a.equity.toFixed(1)} vs ${a.potOdds.toFixed(1)}: ${a.reasoning[0]}`); }
  }
  check('the sweep reached priced decisions', priced > 60, `only ${priced}`);
  check('none of them contradicts its displayed numbers', bad === 0, `${bad}: ${eg.join(' | ')}`);
}

console.log('an all-in call shows the raw figures it was priced on');
{
  const st = flop(['Kd', 'Tc'], ['Ks', '7h', '3d'], 0.36, false);
  st.players[1].stack = 0;  // opponent all-in: no future streets to realise over
  const a = advisePostflopAction(st);
  check('the all-in decision agrees with its numbers', !contradicts(a),
    `${a.action} at ${a.equity.toFixed(1)}% vs ${a.potOdds.toFixed(1)}%`);
  check('and shows unadjusted equity', Math.abs(a.equity - 36) < 0.6, `showed ${a.equity}`);
}

if (failures > 0) { console.error(`\n${failures} postflop-display test(s) failed`); process.exit(1); }
console.log('\nall postflop-display tests passed');
