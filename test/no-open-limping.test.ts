/**
 * N6: the chart's calling tier does not open-limp.
 *
 * Unraised with a price to pay, the 'C' tier returned "completes from X" —
 * written for the small blind completing half a blind. From any other seat
 * that price is a whole big blind with nobody in, and the answer was an open
 * limp: KQo limped from the button, A5s from the cutoff, ATo from UTG. Limping
 * first in gives up the initiative and the fold equity that make these hands
 * playable at all.
 *
 * First in they now open, except offsuit hands under the gun, which fold.
 * Behind a limper, calling along is still allowed, and the small blind still
 * completes.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { lookupRange } from '../src/engine/preflop/ranges';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });

/** Six-handed, dealer seat 0, blinds in seats 1 and 2, us in `heroSeat`. */
function spot(hole: [Card, Card], position: string, heroSeat: number, limper = false): any {
  const players = [0, 1, 2, 3, 4, 5].map(i => ({
    name: i === heroSeat ? 'you' : `p${i}`, seatIndex: i, stack: 2000,
    currentBet: i === 1 ? 10 : i === 2 ? 20 : 0,
    isActive: true, isYou: i === heroSeat, isDealtIn: true,
  }));
  if (limper) players[3].currentBet = 20;   // UTG limped in front of us
  return {
    holeCards: hole, communityCards: [], street: 'preflop',
    pot: limper ? 50 : 30, yourStack: 2000, yourCurrentBet: players[heroSeat].currentBet,
    costToCall: 20 - players[heroSeat].currentBet, minRaise: 40, bigBlind: 20, smallBlind: 10,
    players, activePlayers: 6, position, dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
  };
}
const KQo: [Card, Card] = [c(13, 0), c(12, 1)];
const A5s: [Card, Card] = [c(14, 2), c(5, 2)];
const T9s: [Card, Card] = [c(10, 3), c(9, 3)];
const KJo: [Card, Card] = [c(13, 0), c(11, 1)];

console.log('\nthe hands are in the calling tier');
expect('KQo on the button', lookupRange(13, 12, false, 'BTN'), 'C');
expect('A5s in the cutoff', lookupRange(14, 5, true, 'CO'), 'C');
expect('T9s under the gun', lookupRange(10, 9, true, 'UTG'), 'C');
expect('KJo under the gun', lookupRange(13, 11, false, 'UTG'), 'C');

console.log('\nfirst in, never a limp');
{
  const btn = advisePreflopAction(spot(KQo, 'BTN', 0));
  expect('KQo on the button opens', btn.action, 'raise');
  expect('to a real size', (btn.amount ?? 0) >= 40, true);
  expect('A5s in the cutoff opens', advisePreflopAction(spot(A5s, 'CO', 5)).action, 'raise');
  expect('KQo from middle position opens', advisePreflopAction(spot(KQo, 'MP', 4)).action, 'raise');
  expect('T9s under the gun opens', advisePreflopAction(spot(T9s, 'UTG', 3)).action, 'raise');
  expect('KJo under the gun folds', advisePreflopAction(spot(KJo, 'UTG', 3)).action, 'fold');
}

console.log('\nbehind a limper, and from the small blind');
{
  expect('KQo on the button may call behind a limper', advisePreflopAction(spot(KQo, 'BTN', 0, true)).action !== 'fold', true);
  expect('the small blind still completes', advisePreflopAction(spot(KQo, 'SB', 1)).action !== 'fold', true);
}

console.log(failures > 0 ? `\n${failures} open-limp test(s) failed` : '\nall open-limp tests passed');
process.exit(failures > 0 ? 1 : 0);
