/**
 * E4, stated so that the pre-fix code fails it.
 *
 * `facing-3bet-button.test.ts` covers this fix already, but it cannot show
 * the bug: it imports `facingReraise`, which the fix introduced, so against
 * the pre-fix tree it throws "facingReraise is not a function" before any
 * assertion runs. A test that errors proves the symbol exists, not that the
 * defect is gone. This one is written entirely against `advisePreflopAction`,
 * which long predates the fix, so it runs on both trees and separates them
 * on behaviour.
 *
 * The defect: the button's defend was priced against the heads-up OPENING
 * range of 55% even when the raise in front was a 3-bet over our own open,
 * and the heads-up button chart has no premium tier. Against "55% of hands"
 * almost anything is priced in. Reproduced at a 3bb open facing a 3-bet to
 * 9bb with no read: 151 of 169 hands called — 72s, T2o, J2o and 62s among
 * them — AA and KK flat-called, and the only 4-bets were A5s and A4s, so the
 * whole 4-bet range was bluffs.
 *
 * Measured on the pre-fix tree (a36d729^): 151 calls, 2 raises, 16 folds.
 * Measured on the fixed tree: well under half that many calls, premiums
 * raising, and the junk folding.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `  (${detail})`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

/** Button opened to 3bb, re-raised to 9bb, 100bb deep, no read. */
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

/** The big blind facing a plain open. NOT a re-raise, and must not change. */
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
const all: { n: string; h: [Card, Card] }[] = [];
for (let a = 14; a >= 2; a--) {
  for (let b = a; b >= 2; b--) {
    for (const s of [true, false]) {
      if (a === b && s) continue;
      all.push({
        n: `${R[a]}${R[b]}${a === b ? '' : s ? 's' : 'o'}`,
        h: [c(a, 0), c(b, s ? 0 : 1)],
      });
    }
  }
}

const decide = (g: GameState) =>
  advisePreflopAction(g, NEUTRAL_PARAMS, new Map()).action;

console.log('\nthe whole 169-hand grid, button facing a 3-bet');
{
  const counts = { fold: 0, call: 0, raise: 0, check: 0, other: 0 };
  const called: string[] = [];
  for (const hand of all) {
    const a = decide(buttonFacing3Bet(hand.h));
    if (a === 'fold') counts.fold++;
    else if (a === 'call') { counts.call++; called.push(hand.n); }
    else if (a === 'raise') counts.raise++;
    else if (a === 'check') counts.check++;
    else counts.other++;
  }
  check('the grid is the full 169 hands', all.length === 169, String(all.length));

  // The pre-fix tree calls 151 of 169. Anything near that is the 55%
  // opening range being used to price a 3-bet defend.
  check('it does not call almost everything', counts.call < 100,
    `called ${counts.call} of 169`);
  check('it folds a substantial part of the grid', counts.fold > 40,
    `folded ${counts.fold} of 169`);
  console.log(`       (fold ${counts.fold}, call ${counts.call}, raise ${counts.raise})`);

  // Named in the bug report as hands that called.
  for (const junk of ['72s', 'T2o', 'J2o', '62s']) {
    check(`${junk} does not call a 3-bet`, !called.includes(junk));
  }
}

console.log('\npremiums take the aggressive line rather than flatting');
{
  // The bug report: "AA and KK flat-called, and the only 4-bets were A5s
  // and A4s. The 4-bet range was pure bluff."
  for (const n of ['AA', 'KK', 'QQ', 'AKs']) {
    const hand = all.find(x => x.n === n)!;
    check(`${n} 4-bets`, decide(buttonFacing3Bet(hand.h)) === 'raise');
  }

  const bluffs = ['A5s', 'A4s'].filter(
    n => decide(buttonFacing3Bet(all.find(x => x.n === n)!.h)) === 'raise',
  );
  const value = ['AA', 'KK', 'QQ', 'AKs'].filter(
    n => decide(buttonFacing3Bet(all.find(x => x.n === n)!.h)) === 'raise',
  );
  check('the 4-bet range is not all bluffs', value.length > bluffs.length,
    `${value.length} value vs ${bluffs.length} of the two named bluffs`);
}

console.log('\nan ordinary big blind defend is untouched');
{
  // The fix must not reprice a plain open as if it were a re-raise: one
  // big blind in front of us was posted, not chosen.
  const strong = decide(bbFacingOpen(all.find(x => x.n === 'AA')!.h));
  check('AA still plays back in the big blind', strong === 'raise', strong);

  let defended = 0;
  for (const hand of all) {
    if (decide(bbFacingOpen(hand.h)) !== 'fold') defended++;
  }
  // The BB gets a price and defends wide; if this collapsed to a 3-bet
  // defend the fix would have caught the wrong state.
  check('the big blind still defends widely', defended > 80,
    `defended ${defended} of 169`);
}

if (failures > 0) {
  console.error(`\n${failures} E4 pre-fix test(s) failed`);
  process.exit(1);
}
console.log('\nall E4 pre-fix tests passed');
