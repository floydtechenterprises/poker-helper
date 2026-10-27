/**
 * L11: the blind-tightness dial acts in proportion to how far it has moved.
 *
 * Any value above 1 folded every marginal blind defend. The dial is blended
 * with the per-opponent weight, so a faint read (1.02) and a confident one
 * (1.2) did exactly the same thing. It now folds that share of the eligible
 * hands, chosen by the card hash like every other mixed line.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { NEUTRAL_PARAMS, BLIND_TIGHTNESS_FULL } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

/** Three-handed, hero in the big blind facing a 2.5bb raise. */
function spot(hole: [Card, Card]): GameState {
  const BB = 20;
  return {
    holeCards: hole, communityCards: [], street: 'preflop',
    pot: 50 + BB + 10, yourStack: 1000, yourCurrentBet: BB, costToCall: 30, minRaise: 100,
    bigBlind: BB, smallBlind: 10,
    players: [
      { name: 'you', seatIndex: 2, stack: 1000, currentBet: BB, isActive: true, isYou: true },
      { name: 'v', seatIndex: 0, stack: 1000, currentBet: 50, isActive: true, isYou: false },
      { name: 'sb', seatIndex: 1, stack: 1000, currentBet: 10, isActive: true, isYou: false },
    ],
    activePlayers: 3, position: 'BB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

const deck: Card[] = [];
for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) deck.push({ rank: r as any, suit: s as any });

function tightenedShare(dial: number): { share: number; eligible: number } {
  let eligible = 0, tightened = 0;
  for (let i = 0; i < 52; i++) for (let j = i + 1; j < 52; j++) {
    const h: [Card, Card] = [deck[i], deck[j]];
    const neutral = advisePreflopAction(spot(h), NEUTRAL_PARAMS, new Map());
    if (neutral.action !== 'call') continue;
    const full = advisePreflopAction(spot(h), { ...NEUTRAL_PARAMS, blindTightness: BLIND_TIGHTNESS_FULL }, new Map());
    if (!full.reasoning.some(r => /defending the blinds/.test(r))) continue;
    eligible++;
    const at = advisePreflopAction(spot(h), { ...NEUTRAL_PARAMS, blindTightness: dial }, new Map());
    if (at.reasoning.some(r => /defending the blinds/.test(r))) tightened++;
  }
  return { share: eligible ? tightened / eligible : 0, eligible };
}

console.log('\nhow many marginal defends the dial folds');
{
  const full = tightenedShare(BLIND_TIGHTNESS_FULL);
  const half = tightenedShare(1 + (BLIND_TIGHTNESS_FULL - 1) / 2);
  const faint = tightenedShare(1 + (BLIND_TIGHTNESS_FULL - 1) / 10);
  check(`there are marginal defends to fold (${full.eligible})`, full.eligible > 20);
  check(`a full read folds all of them (${(full.share * 100).toFixed(0)}%)`, full.share === 1);
  check(`half a read folds about half (${(half.share * 100).toFixed(0)}%)`, half.share > 0.3 && half.share < 0.7);
  check(`a faint read folds few (${(faint.share * 100).toFixed(0)}%)`, faint.share < 0.25,
    'any movement above 1 folded every one of them');
  check('neutral folds none', tightenedShare(1).share === 0);
}

console.log(failures > 0 ? `\n${failures} blind-tightness test(s) failed` : '\nall blind-tightness tests passed');
process.exit(failures > 0 ? 1 : 0);
