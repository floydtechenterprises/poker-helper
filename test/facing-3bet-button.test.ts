/**
 * E4: the button facing a 3-bet must defend a 3-bet range, and 4-bet value.
 *
 * Reproduced before the fix, button 3bb open facing a 3-bet to 9bb:
 * 151 hands called (72s, T2o, J2o, 62s among them), AA and KK flat-called,
 * and the only 4-bets were A5s and A4s — an all-bluff 4-bet range. The defend
 * was priced against the 55% heads-up OPENING range, and nothing 4-bet value.
 */
import { advisePreflopAction, threeBetSize, facingReraise } from '../src/engine/preflop/preflop-advisor';
import { isPremiumHand } from '../src/engine/preflop/ranges';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

function buttonFacing3Bet(h: [Card, Card]): GameState {
  const stack = BB * 100;
  return {
    holeCards: h, communityCards: [], street: 'preflop',
    pot: 1200, yourStack: stack - 300, yourCurrentBet: 300, costToCall: 600,
    minRaise: 1500, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: stack - 300, currentBet: 300, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: stack - 900, currentBet: 900, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}
function bbFacingOpen(h: [Card, Card]): GameState {
  const stack = BB * 100;
  return {
    holeCards: h, communityCards: [], street: 'preflop',
    pot: 350, yourStack: stack - 100, yourCurrentBet: 100, costToCall: 150,
    minRaise: 500, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: stack - 100, currentBet: 100, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: stack - 250, currentBet: 250, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

const R = '  23456789TJQKA';
const all: { n: string; h: [Card, Card]; prem: boolean }[] = [];
for (let a = 14; a >= 2; a--) for (let b = a; b >= 2; b--) for (const s of [true, false]) {
  if (a === b && s) continue;
  all.push({ n: `${R[a]}${R[b]}${a === b ? '' : s ? 's' : 'o'}`, h: [c(a, 0), c(b, s ? 0 : 1)], prem: isPremiumHand(a as any, b as any, s) });
}

console.log('recognising a re-raise');
check('the button facing a 3-bet is facing a re-raise', facingReraise(buttonFacing3Bet([c(14, 0), c(14, 1)])));
check('the big blind facing an open is NOT', !facingReraise(bbFacingOpen([c(14, 0), c(14, 1)])));

console.log('premiums 4-bet for value');
for (const n of ['AA', 'KK', 'QQ', 'AKs', 'AKo']) {
  const hand = all.find(x => x.n === n)!;
  const r = advisePreflopAction(buttonFacing3Bet(hand.h), NEUTRAL_PARAMS, new Map());
  check(`${n} 4-bets`, r.action === 'raise', `${n} chose ${r.action}`);
}

console.log('the 4-bet range contains value AND bluffs, at one size');
{
  const raises = all.map(x => ({ ...x, r: advisePreflopAction(buttonFacing3Bet(x.h), NEUTRAL_PARAMS, new Map()) }))
    .filter(x => x.r.action === 'raise');
  const value = raises.filter(x => x.prem), bluffs = raises.filter(x => !x.prem);
  check('it has value hands', value.length >= 8, `${value.length} value 4-bets`);
  check('it is not all bluff', value.length > bluffs.length);
  const sizes = [...new Set(raises.map(x => x.r.amount))];
  check('every 4-bet is the same size', sizes.length === 1, `sizes: ${sizes.join(', ')}`);
  check('and it is a 4-bet sized multiple, not a 3-bet one', sizes[0] === Math.round(900 * 2.3),
    `got ${sizes[0]}, expected ${Math.round(900 * 2.3)}`);
}

console.log('the defending range is a 3-bet defend, not an open');
{
  const cont = all.filter(x => advisePreflopAction(buttonFacing3Bet(x.h), NEUTRAL_PARAMS, new Map()).action !== 'fold');
  check('it no longer continues with ~90% of hands', cont.length < 130, `${cont.length} of 169 continue`);
  for (const n of ['72s', 'T2o', 'J2o', '62s', '72o']) {
    const hand = all.find(x => x.n === n)!;
    const r = advisePreflopAction(buttonFacing3Bet(hand.h), NEUTRAL_PARAMS, new Map());
    check(`${n} folds to a 3-bet`, r.action === 'fold', `${n} chose ${r.action}`);
  }
}

console.log('an ordinary 3-bet is unaffected');
{
  const aa = advisePreflopAction(bbFacingOpen([c(14, 0), c(14, 1)]), NEUTRAL_PARAMS, new Map());
  check('the BB still 3-bets AA to 3.5x the open', aa.action === 'raise' && aa.amount === 875,
    `got ${aa.action} ${aa.amount}`);
  check('threeBetSize is unchanged for a 3-bet', threeBetSize(bbFacingOpen([c(14, 0), c(14, 1)])) === 875);
}

if (failures > 0) { console.error(`\n${failures} facing-3bet test(s) failed`); process.exit(1); }
console.log('\nall facing-3bet tests passed');
