/**
 * Preflop, "facing a raise" means someone bet more than the big blind.
 *
 * The engine tested it as `costToCall > bigBlind` in some places and
 * `costToCall >= bigBlind` in others, and neither is the question:
 *
 *   - `>` misses a min-raise, which leaves exactly one big blind to call.
 *     The button that limped and faced a 2bb raise was treated as opening an
 *     unopened pot, so the steal read reshaped its range while it faced a
 *     raise, and folds were explained as "outside the opening range".
 *   - `>=` counts the unopened pot multiway, where the first player to act
 *     already owes the big blind. First in from UTG six-handed, the engine
 *     raised NOTHING: it limped 29 hands, AA and AK among them, each
 *     "defending" against the blind at a 40% price, and folded the rest.
 *
 * Heads-up the second failure cannot happen (the button owes half a blind),
 * which is why it went unnoticed in a heads-up match.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { facingPreflopRaise } from '../src/engine/pot-odds';
import { lookupRange } from '../src/engine/preflop/ranges';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
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
    pot: bets.reduce((a, b) => a + b, 0), yourStack: 10000 - heroBet, yourCurrentBet: heroBet,
    costToCall: maxBet - heroBet, minRaise: maxBet * 2, bigBlind: BB, smallBlind: BB / 2,
    players: bets.map((b, i) => ({
      name: i === hero ? 'you' : `p${i}`, seatIndex: i, stack: 10000 - b, currentBet: b,
      isActive: true, isYou: i === hero,
    })),
    activePlayers: n,
    position: (n === 2 ? (hero === 0 ? 'SB' : 'BB') : hero === 0 ? 'BTN' : hero === 1 ? 'SB' : hero === 2 ? 'BB' : 'UTG') as any,
    dealerSeatIndex: 0,
    availableActions: maxBet > heroBet ? ['fold', 'call', 'raise'] : ['check', 'raise'],
  } as GameState;
}

console.log('the predicate answers the actual question');
{
  // Heads-up: seat 0 is the button/small blind, seat 1 the big blind
  check('HU button, unopened', !facingPreflopRaise(table([50, 100], 0)));
  check('HU big blind facing a limp', !facingPreflopRaise(table([100, 100], 1)));
  check('HU big blind facing a min-raise', facingPreflopRaise(table([200, 100], 1)));
  check('HU button that limped, facing a min-raise', facingPreflopRaise(table([100, 200], 0)));
  check('HU button facing a min 3-bet', facingPreflopRaise(table([200, 300], 0)));
  // Six-handed: dealer 0, SB 1, BB 2, UTG 3
  check('UTG first in, six-handed', !facingPreflopRaise(table([0, 50, 100, 0, 0, 0], 3)));
  check('UTG facing only a limp', !facingPreflopRaise(table([0, 50, 100, 0, 100, 0], 3)));
  check('BB facing a min-raise, six-handed', facingPreflopRaise(table([200, 50, 100, 0, 0, 0], 2)));
}

console.log('first in multiway, the hands the chart raises do raise');
{
  const RK = '  23456789TJQKA';
  let chartRaises = 0; const notRaised: string[] = [];
  for (let a = 14; a >= 2; a--) for (let b = a; b >= 2; b--) for (const s of [true, false]) {
    if (a === b && s) continue;
    const tier = lookupRange(a as any, b as any, s, 'UTG');
    if (tier !== 'R' && tier !== '3') continue;
    chartRaises++;
    const r = advisePreflopAction(table([0, 50, 100, 0, 0, 0], 3, [c(a, 0), c(b, s ? 0 : 1)]), NEUTRAL_PARAMS, new Map());
    if (r.action !== 'raise') notRaised.push(`${RK[a]}${RK[b]}${a === b ? '' : s ? 's' : 'o'}:${r.action}`);
  }
  const aa = advisePreflopAction(table([0, 50, 100, 0, 0, 0], 3, [c(14, 0), c(14, 1)]), NEUTRAL_PARAMS, new Map());
  check('AA raises first in from UTG', aa.action === 'raise', `${aa.action}: ${aa.reasoning[0]}`);
  check(`every UTG raising hand raises (${chartRaises} classes)`, notRaised.length === 0,
    `${notRaised.length} did not: ${notRaised.slice(0, 8).join(' ')}`);
  check('nothing "defends" against the blind', !aa.reasoning.some(r => /defends/.test(r)));
}

console.log('a min-raise is a raise, heads-up');
{
  // Hero in the big blind facing the button's open: 2bb and 2.01bb are the same decision
  const RK = '  23456789TJQKA';
  const differ: string[] = []; let openingWording = 0;
  for (let a = 14; a >= 2; a--) for (let b = a; b >= 2; b--) for (const s of [true, false]) {
    if (a === b && s) continue;
    const h: [Card, Card] = [c(a, 0), c(b, s ? 0 : 1)];
    const min = advisePreflopAction(table([200, 100], 1, h), NEUTRAL_PARAMS, new Map());
    const more = advisePreflopAction(table([201, 100], 1, h), NEUTRAL_PARAMS, new Map());
    if (min.action !== more.action) differ.push(`${RK[a]}${RK[b]}${a === b ? '' : s ? 's' : 'o'}`);
    if (min.reasoning.some(r => /opening range/.test(r))) openingWording++;
  }
  check('2bb and 2.01bb opens get the same decisions', differ.length === 0, differ.join(' '));
  check('no fold facing a min-raise is explained as an opening decision', openingWording === 0,
    `${openingWording} folds said "outside the opening range"`);
}

console.log('the learned blind discipline covers min-raises');
{
  // Three-handed so blind tightness applies; T8s is a priced call from the big blind
  const t8s: [Card, Card] = [c(10, 3), c(8, 3)];
  const learned = { ...NEUTRAL_PARAMS, blindTightness: 1.2 };
  const minRaise = advisePreflopAction(table([200, 50, 100], 2, t8s), learned, new Map());
  const bigger = advisePreflopAction(table([250, 50, 100], 2, t8s), learned, new Map());
  check('it treats a 2bb raise like a 2.5bb one', minRaise.action === bigger.action,
    `2bb: ${minRaise.action}, 2.5bb: ${bigger.action}`);
}

console.log(failures > 0 ? `\n${failures} facing-a-raise test(s) failed` : '\nall facing-a-raise tests passed');
process.exit(failures > 0 ? 1 : 0);
