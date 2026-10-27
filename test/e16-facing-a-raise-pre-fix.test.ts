/**
 * E16, stated so that the pre-fix code fails it.
 *
 * `facing-a-raise.test.ts` imports `facingPreflopRaise`, the predicate the
 * fix introduced, so on the pre-fix tree it throws before reaching the two
 * sections that would have caught the defect. This runs the same behaviour
 * through `advisePreflopAction` and `lookupRange`, both of which predate the
 * fix.
 *
 * The defect: "facing a raise" was asked as `costToCall > bigBlind` in some
 * places and `costToCall >= bigBlind` in others. What we owe depends on what
 * we already have in, so neither can tell a raise from a blind.
 *
 *   `>=` counts the unopened pot multiway, where the first player to act
 *   owes exactly the big blind. First in from UTG six-handed the engine
 *   raised NOTHING: every chart raising hand, AA and AK included, limped as
 *   a "defend" against the blind at a 40% price.
 *
 *   `>` misses a min-raise, which leaves exactly one big blind to call. The
 *   button that limped and then faced a 2bb raise was treated as opening an
 *   unopened pot, and its folds were explained as "outside the opening
 *   range" while it was facing a raise.
 *
 * Heads-up the button owes half a blind, so the multiway failure never
 * showed in a heads-up match — which is where this extension is used.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { lookupRange } from '../src/engine/preflop/ranges';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `  (${detail})`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

/** Seats 0..n-1, dealer at 0. `bets[i]` is what seat i has in; hero at `hero`. */
function table(bets: number[], hero: number, hole: [Card, Card] = [c(14, 0), c(14, 1)]): GameState {
  const heroBet = bets[hero];
  const maxBet = Math.max(...bets);
  const n = bets.length;
  return {
    holeCards: hole, communityCards: [], street: 'preflop',
    pot: bets.reduce((a, b) => a + b, 0),
    yourStack: 10000 - heroBet, yourCurrentBet: heroBet,
    costToCall: maxBet - heroBet, minRaise: maxBet * 2,
    bigBlind: BB, smallBlind: BB / 2,
    players: bets.map((b, i) => ({
      name: i === hero ? 'you' : `p${i}`, seatIndex: i, stack: 10000 - b,
      currentBet: b, isActive: true, isYou: i === hero,
    })),
    activePlayers: n,
    position: (n === 2
      ? (hero === 0 ? 'SB' : 'BB')
      : hero === 0 ? 'BTN' : hero === 1 ? 'SB' : hero === 2 ? 'BB' : 'UTG') as any,
    dealerSeatIndex: 0,
    availableActions: maxBet > heroBet ? ['fold', 'call', 'raise'] : ['check', 'raise'],
  } as GameState;
}

const advise = (g: GameState) => advisePreflopAction(g, NEUTRAL_PARAMS, new Map());

// Six-handed: dealer 0, SB 1, BB 2, UTG 3. UTG first in owes the big blind.
const utgFirstIn = (hole?: [Card, Card]) => table([0, 50, 100, 0, 0, 0], 3, hole);

console.log('\nfirst in from UTG, the engine opens rather than limping the blind');
{
  const RK = '  23456789TJQKA';
  let chartRaises = 0;
  const notRaised: string[] = [];
  for (let a = 14; a >= 2; a--) {
    for (let b = a; b >= 2; b--) {
      for (const s of [true, false]) {
        if (a === b && s) continue;
        const tier = lookupRange(a as any, b as any, s, 'UTG');
        if (tier !== 'R' && tier !== '3') continue;
        chartRaises++;
        const r = advise(utgFirstIn([c(a, 0), c(b, s ? 0 : 1)]));
        if (r.action !== 'raise') {
          notRaised.push(`${RK[a]}${RK[b]}${a === b ? '' : s ? 's' : 'o'}:${r.action}`);
        }
      }
    }
  }
  check('the chart has UTG raising hands to check', chartRaises > 0, String(chartRaises));
  check(`every UTG raising hand raises (${chartRaises} classes)`, notRaised.length === 0,
    `${notRaised.length} did not: ${notRaised.slice(0, 8).join(' ')}`);

  const aa = advise(utgFirstIn([c(14, 0), c(14, 1)]));
  check('AA raises first in from UTG', aa.action === 'raise',
    `${aa.action}: ${aa.reasoning[0]}`);
  check('AK raises first in from UTG',
    advise(utgFirstIn([c(14, 0), c(13, 1)])).action === 'raise');
  check('nothing "defends" against its own blind',
    !aa.reasoning.some(r => /defend/i.test(r)), aa.reasoning.join(' | '));
}

console.log('\na min-raise is a raise, not an unopened pot');
{
  // The button limped, someone made it 2bb. We owe exactly one big blind,
  // which is what `costToCall > bigBlind` fails to see.
  const limpedThenMinRaised = (hole: [Card, Card]) => table([100, 200], 0, hole);
  const limpedThenRaised = (hole: [Card, Card]) => table([100, 250], 0, hole);

  const junk: [Card, Card] = [c(7, 0), c(2, 1)];
  const minR = advise(limpedThenMinRaised(junk));
  check('a fold to a min-raise is not explained as an opening range',
    !minR.reasoning.some(r => /opening range/i.test(r)),
    minR.reasoning.join(' | '));
  check('nor as a steal read',
    !minR.reasoning.some(r => /steal/i.test(r)),
    minR.reasoning.join(' | '));

  // The 2bb and 2.5bb raises are the same situation; the predicate split
  // them, so T8s called one and folded the other.
  const t8s: [Card, Card] = [c(10, 0), c(8, 0)];
  const a2 = advise(limpedThenMinRaised(t8s)).action;
  const a25 = advise(limpedThenRaised(t8s)).action;
  check('T8s treats a 2bb and a 2.5bb raise alike', a2 === a25,
    `2bb ${a2} vs 2.5bb ${a25}`);
}

console.log('\nheads-up, where the bug could not show, nothing moved');
{
  // The button owes half a blind, so neither comparison misfires. These
  // must pass on both trees — they are the control.
  const huButton = (hole: [Card, Card]) => table([50, 100], 0, hole);
  check('AA raises on the heads-up button',
    advise(huButton([c(14, 0), c(14, 1)])).action === 'raise');
  check('72o does not raise on the heads-up button',
    advise(huButton([c(7, 0), c(2, 1)])).action !== 'raise');
}

if (failures > 0) {
  console.error(`\n${failures} E16 pre-fix test(s) failed`);
  process.exit(1);
}
console.log('\nall E16 pre-fix tests passed');
