/**
 * E8, stated so that the pre-fix code fails it.
 *
 * `raise-sized-as-bet.test.ts` covers this fix, but its first section calls
 * `theirBetToPot`, which the fix introduced, so on the pre-fix tree the file
 * throws before reaching the assertions that would have caught the defect.
 * Everything here goes through `estimateOpponentRange` and
 * `estimateOpponentSpec`, both of which predate the fix.
 *
 * The defect: four places sized an opponent's bet as
 * `costToCall / (pot - costToCall)`. For a plain bet into us that is right.
 * Once WE have chips in, `costToCall` is only what we still owe, not what
 * they bet, so every re-raise read as far smaller than it was.
 *
 * Reproduced on the turn: we bet 100 into 200 and they raise to 400. That is
 * 400 into a 300 pot, 1.33x — identical in chips to a 400 bet into 300 — but
 * it read as 300/400 = 0.75x. The two were modelled as different hands: the
 * raise at 35% with one pair as value, the bet at 30% with two pair minimum.
 * A turn raise, normally the stronger action, was treated as the weaker.
 *
 * The test is a pure identity: the same chips in the middle must produce the
 * same model of the opponent, whichever way they got there. That is true of
 * the fixed tree and false of the pre-fix one, and it says nothing about any
 * particular range width, so it does not rot when the ranges are retuned.
 */
import { estimateOpponentRange, estimateOpponentSpec } from '../src/engine/equity/monte-carlo';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `  (${detail})`}`);
  if (!cond) failures++;
}
const S: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };
const RK: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};
const card = (t: string): Card => ({ rank: RK[t[0]] as any, suit: S[t[1]] as any });

/**
 * A turn spot. `yourBet` is what we already put in this street, `theirBet`
 * what they have in total, `potBeforeStreet` what was there when it began —
 * so the pot and the chips are identical between a bet and a raise that
 * reach the same total.
 */
function turn(yourBet: number, theirBet: number, potBeforeStreet: number): GameState {
  return {
    holeCards: [card('Kd'), card('Qc')],
    communityCards: ['Kh', '8c', '4d', '2s'].map(card),
    street: 'turn',
    pot: potBeforeStreet + yourBet + theirBet,
    yourStack: 10000, yourCurrentBet: yourBet,
    costToCall: theirBet - yourBet, minRaise: theirBet * 2,
    bigBlind: 20, smallBlind: 10,
    players: [
      { name: 'you', seatIndex: 0, stack: 10000, currentBet: yourBet, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 10000, currentBet: theirBet, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    heroIsPreflopAggressor: true,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

console.log('\nthe same chips model the same opponent, bet or raise');
{
  // 400 into 300, reached two ways.
  const bet = turn(0, 400, 300);
  const raise = turn(100, 400, 200);

  check('the two spots really are the same size',
    bet.pot === raise.pot && bet.players[1].currentBet === raise.players[1].currentBet,
    `pot ${bet.pot}/${raise.pot}`);

  const rb = estimateOpponentRange(bet, undefined);
  const rr = estimateOpponentRange(raise, undefined);
  check('same assumed range', rb === rr, `bet ${rb} vs raise ${rr}`);

  const sb = estimateOpponentSpec(bet, undefined);
  const sr = estimateOpponentSpec(raise, undefined);
  check('same minimum hand counted as value', sb.minCategory === sr.minCategory,
    `bet ${sb.minCategory} vs raise ${sr.minCategory}`);
  check('same value weight',
    Math.abs(sb.valueWeight - sr.valueWeight) < 1e-9,
    `bet ${sb.valueWeight} vs raise ${sr.valueWeight}`);
}

console.log('\nthe raise is not read as the weaker action');
{
  // The direction of the error, stated on its own: under-sizing a raise
  // makes the opponent look wider than the identical bet does.
  const bet = turn(0, 400, 300);
  const raise = turn(100, 400, 200);
  const rb = estimateOpponentRange(bet, undefined);
  const rr = estimateOpponentRange(raise, undefined);
  check('the raise is not modelled wider than the equal bet', rr <= rb,
    `raise ${rr} vs bet ${rb}`);
}

console.log('\nthe identity holds at other sizes too');
{
  // Not a one-off coincidence at 400: any split of the same total.
  const cases: [number, number, number, number][] = [
    // ourBet, theirTotal, potBefore, (same total reached as a plain bet)
    [50, 200, 250, 200],
    [200, 600, 200, 600],
    [100, 250, 150, 250],
  ];
  for (const [ours, theirs, before] of cases) {
    const asRaise = turn(ours, theirs, before);
    const asBet = turn(0, theirs, before + ours);
    const rr = estimateOpponentRange(asRaise, undefined);
    const rb = estimateOpponentRange(asBet, undefined);
    check(`raise to ${theirs} over ${ours} matches a ${theirs} bet`, rr === rb,
      `raise ${rr} vs bet ${rb}`);
  }
}

console.log('\nan ordinary bet with nothing of ours in is unchanged');
{
  // The fix must be a no-op when yourCurrentBet is 0, or it would have
  // moved every plain bet in the engine.
  const halfPot = turn(0, 100, 200);
  const spec = estimateOpponentSpec(halfPot, undefined);
  check('a half-pot bet still produces a usable spec',
    Number.isFinite(spec.valueWeight) && spec.minCategory >= 0,
    `weight ${spec.valueWeight}, min ${spec.minCategory}`);
  check('and a range between 0 and 1',
    estimateOpponentRange(halfPot, undefined) > 0
    && estimateOpponentRange(halfPot, undefined) <= 1);
}

if (failures > 0) {
  console.error(`\n${failures} E8 pre-fix test(s) failed`);
  process.exit(1);
}
console.log('\nall E8 pre-fix tests passed');
