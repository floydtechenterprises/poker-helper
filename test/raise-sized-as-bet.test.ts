/**
 * E8: a raise over our bet is sized by what they bet, not what we owe.
 *
 * Four places sized a bet as costToCall / (pot - costToCall). Once we have
 * chips in, costToCall is only what we still owe. Reproduced: we bet 100 into
 * 200 on the turn and they raise to 400 — 1.33x the pot — which read as 0.75x.
 * Their range was modelled at 35% with one pair as value instead of 30% with
 * two pair minimum, and KQ on K-8-4-2 showed 81.1% equity against the raise
 * but 41.5% against the identical chips as a bet.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { theirBetToPot } from '../src/engine/pot-odds';
import { estimateOpponentRange, estimateOpponentSpec } from '../src/engine/equity/monte-carlo';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const S: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };
const RK: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const card = (t: string): Card => ({ rank: RK[t[0]] as any, suit: S[t[1]] as any });

function turn(yourBet: number, theirBet: number, potBeforeStreet: number): GameState {
  return {
    holeCards: [card('Kd'), card('Qc')], communityCards: ['Kh', '8c', '4d', '2s'].map(card), street: 'turn',
    pot: potBeforeStreet + yourBet + theirBet, yourStack: 10000, yourCurrentBet: yourBet,
    costToCall: theirBet - yourBet, minRaise: theirBet * 2, bigBlind: 20, smallBlind: 10,
    players: [
      { name: 'you', seatIndex: 0, stack: 10000, currentBet: yourBet, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 10000, currentBet: theirBet, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1, heroIsPreflopAggressor: true,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

console.log('the sizing arithmetic');
{
  check('a plain bet is unchanged: 400 into 300', Math.abs(theirBetToPot({ pot: 700, costToCall: 400, yourCurrentBet: 0 }) - 400 / 300) < 1e-9);
  check('a raise to 400 over our 100, into 300, is the same 1.33x',
    Math.abs(theirBetToPot({ pot: 700, costToCall: 300, yourCurrentBet: 100 }) - 400 / 300) < 1e-9,
    `got ${theirBetToPot({ pot: 700, costToCall: 300, yourCurrentBet: 100 })}`);
  check('a half-pot bet reads 0.5', Math.abs(theirBetToPot({ pot: 150, costToCall: 50, yourCurrentBet: 0 }) - 0.5) < 1e-9);
  check('a misread pot cannot produce Infinity', Number.isFinite(theirBetToPot({ pot: 0, costToCall: 100, yourCurrentBet: 0 })));
}

console.log('a raise is modelled exactly like a bet of the same size');
{
  const bet = turn(0, 400, 300), raise = turn(100, 400, 200);
  check('same assumed range', estimateOpponentRange(bet, undefined) === estimateOpponentRange(raise, undefined),
    `bet ${estimateOpponentRange(bet, undefined)} vs raise ${estimateOpponentRange(raise, undefined)}`);
  const sb = estimateOpponentSpec(bet, undefined), sr = estimateOpponentSpec(raise, undefined);
  check('same minimum hand counted as value', sb.minCategory === sr.minCategory,
    `bet ${sb.minCategory} vs raise ${sr.minCategory}`);
  check('two pair is the minimum, not one pair', sr.minCategory >= 2, `got ${sr.minCategory}`);
  check('same value weight', Math.abs(sb.valueWeight - sr.valueWeight) < 1e-9);
}

console.log('no copy of the old formula survives');
for (const f of ['src/engine/equity/monte-carlo.ts', 'src/engine/postflop/float-play.ts', 'src/engine/postflop/postflop-advisor.ts']) {
  const src = readFileSync(join(process.cwd(), f), 'utf8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  check(`${f} sizes bets through theirBetToPot`, !/costToCall\s*\/\s*Math\.max\(1,\s*state\.pot\s*-\s*state\.costToCall\)/.test(src)
    && !/state\.pot\s*-\s*state\.costToCall/.test(src));
}

if (failures > 0) { console.error(`\n${failures} raise-sizing test(s) failed`); process.exit(1); }
console.log('\nall raise-sizing tests passed');
