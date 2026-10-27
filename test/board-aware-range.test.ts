/**
 * The opponent's range has to know what the board looks like.
 *
 * It used to be one number: "the top X% of STARTING hands". That number
 * cannot express "they have a straight", and on a coordinated board it is
 * actively backwards — on 9-T-J it fills their range with AA, AQ and AJ
 * (one pair here) while REJECTING Q8 and 87, the hands that actually made
 * the straight.
 *
 * Measured before the fix: bottom pair on 9-T-J-2 facing a pot-sized shove
 * came out at 40% equity against a 33% price, so it called. Every time.
 */
import { calculateEquity, estimateOpponentRange, estimateOpponentSpec } from '../src/engine/equity/monte-carlo';
import { valueSplitFor, toRangeSpec, CATEGORY, ANY_TWO, effectiveMinCategory } from '../src/engine/equity/range-spec';
import { GameState, Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectBetween(name: string, actual: number, lo: number, hi: number): void {
  if (actual >= lo && actual <= hi) console.log(`  PASS ${name} (${actual.toFixed(3)})`);
  else { console.error(`  FAIL ${name}: ${actual} outside [${lo}, ${hi}]`); failures++; }
}

const c = (r: number, s: number): Card =>
  ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function shoveSpot(board: Card[], hero: [Card, Card], street: GameState['street']): GameState {
  return {
    holeCards: hero, communityCards: board, street,
    pot: 2000, yourStack: 1000, yourCurrentBet: 0, costToCall: 1000,
    minRaise: 0, bigBlind: 20, smallBlind: 10,
    players: [
      { name: 'you', seatIndex: 0, stack: 1000, currentBet: 0, isActive: true, isYou: true },
      { name: 'noob', seatIndex: 1, stack: 0, currentBet: 1000, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call'],
  } as GameState;
}

const ITERS = 20000;
const eqOf = (st: GameState, spec: any) =>
  calculateEquity(st.holeCards, st.communityCards, 1, ITERS, spec).equity;

console.log('a bad pair on a straight-heavy board is no longer a call');
{
  // 9-T-J-2, we hold 9-4. Anyone with Q, 8 or K has a straight or is drawing
  const st = shoveSpot([c(9, 0), c(10, 1), c(11, 2), c(2, 3)], [c(9, 1), c(4, 0)], 'turn');
  const before = eqOf(st, estimateOpponentRange(st));
  const after = eqOf(st, estimateOpponentSpec(st));
  const price = st.costToCall / (st.pot + st.costToCall); // 33%

  expect('the old model called this', before > price, true);
  expect('the new model folds it', after > price, false);
  expectBetween('and the estimate is realistic', after, 0.05, 0.30);
}

console.log('but real hands are still called');
{
  // We hold the straight ourselves — must not start folding the nuts
  const st = shoveSpot([c(9, 0), c(10, 1), c(11, 2), c(2, 3)], [c(12, 1), c(8, 0)], 'turn');
  const after = eqOf(st, estimateOpponentSpec(st));
  expect('a made straight still calls a shove',
    after > st.costToCall / (st.pot + st.costToCall), true);
  expectBetween('with a high estimate', after, 0.6, 1.0);
}

console.log('the value split responds to size, street and shoving');
{
  const flopSmall = valueSplitFor({ street: 'flop', betToPot: 0.3, allIn: false });
  const riverPot = valueSplitFor({ street: 'river', betToPot: 1.0, allIn: false });
  const riverShove = valueSplitFor({ street: 'river', betToPot: 1.0, allIn: true });

  expect('a small flop bet is mostly not value',
    flopSmall.valueWeight < 0.55, true);
  expect('a pot-sized river bet is mostly value',
    riverPot.valueWeight > flopSmall.valueWeight, true);
  expect('a shove is stronger still',
    riverShove.valueWeight > riverPot.valueWeight, true);
  expect('and a big river bet demands more than one pair',
    riverPot.minCategory >= CATEGORY.TWO_PAIR, true);
  expect('preflop has no board to connect with',
    valueSplitFor({ street: 'preflop', betToPot: 3, allIn: false }).valueWeight, 0);
}

console.log('a known bluffer keeps a wider range than a nit');
{
  const nitty = valueSplitFor({ street: 'river', betToPot: 1, allIn: true, bluffiness: 0.2 });
  const wild = valueSplitFor({ street: 'river', betToPot: 1, allIn: true, bluffiness: 0.85 });
  expect('the maniac is given more bluffs', wild.valueWeight < nitty.valueWeight, true);
}

console.log('nothing is broken when there is no bet to read');
{
  const st = shoveSpot([c(9, 0), c(10, 1), c(11, 2)], [c(9, 1), c(4, 0)], 'flop');
  st.costToCall = 0;
  const spec = estimateOpponentSpec(st);
  expect('no bet means no value filter', spec.valueWeight, 0);
}

console.log('the old scalar form still works everywhere');
{
  expect('a number becomes a percentile-only spec', toRangeSpec(0.25).percentile, 0.25);
  expect('with the value filter off', toRangeSpec(0.25).valueWeight, 0);
  expect('any-two is the identity', ANY_TWO.percentile, 1);

  // Calling with a raw number must behave exactly as it always did
  const board = [c(9, 0), c(10, 1), c(11, 2), c(2, 3)];
  const hero: [Card, Card] = [c(9, 1), c(4, 0)];
  const viaNumber = calculateEquity(hero, board, 1, ITERS, 0.35).equity;
  const viaSpec = calculateEquity(hero, board, 1, ITERS,
    { percentile: 0.35, valueWeight: 0, minCategory: 0 }).equity;
  // Same model, different sampling — a couple of points apart at most
  expectBetween('scalar and equivalent spec agree', Math.abs(viaNumber - viaSpec), 0, 0.03);
}

console.log('equity stays a probability under every spec');
{
  let bad = 0;
  const board = [c(9, 0), c(10, 1), c(11, 2)];
  const hero: [Card, Card] = [c(9, 1), c(4, 0)];
  for (const percentile of [0.05, 0.35, 1]) {
    for (const valueWeight of [0, 0.5, 1]) {
      for (const minCategory of [0, CATEGORY.PAIR, CATEGORY.STRAIGHT, CATEGORY.QUADS]) {
        const e = calculateEquity(hero, board, 1, 2000,
          { percentile, valueWeight, minCategory }).equity;
        if (!Number.isFinite(e) || e < 0 || e > 1) bad++;
      }
    }
  }
  expect('36 combinations all produce a valid probability', bad, 0);
}


console.log('the requirement is relative to the board, not absolute');
{
  // minCategory is checked against the opponent's full seven cards, which
  // the board can satisfy alone: on K-K-7-7-2 the board IS two pair, so
  // "at least two pair" was true of 100% of hands and the filter did
  // nothing on exactly the boards where one card beats you.
  expect('an unpaired board is unaffected',
    effectiveMinCategory(CATEGORY.TWO_PAIR, CATEGORY.HIGH_CARD), CATEGORY.TWO_PAIR);
  expect('a one-pair board still asks for two pair',
    effectiveMinCategory(CATEGORY.TWO_PAIR, CATEGORY.PAIR), CATEGORY.TWO_PAIR);
  expect('a two-pair board demands trips',
    effectiveMinCategory(CATEGORY.TWO_PAIR, CATEGORY.TWO_PAIR), CATEGORY.TRIPS);
  expect('a trips board demands a straight or better',
    effectiveMinCategory(CATEGORY.TWO_PAIR, CATEGORY.TRIPS), CATEGORY.STRAIGHT);

  // End to end: nothing-hands on paired boards now fold
  const trips = shoveSpot([c(9,0),c(9,1),c(9,2),c(4,3),c(2,0)], [c(13,1),c(12,0)], 'river');
  const eqTrips = eqOf(trips, estimateOpponentSpec(trips));
  expect('K-Q on a trips board folds to a shove',
    eqTrips > trips.costToCall / (trips.pot + trips.costToCall), false);

  // But a genuine full house still calls
  const full = shoveSpot([c(13,0),c(13,1),c(7,2),c(7,3),c(2,0)], [c(13,2),c(3,0)], 'river');
  const eqFull = eqOf(full, estimateOpponentSpec(full));
  expect('holding a king on K-K-7-7-2 still calls',
    eqFull > full.costToCall / (full.pot + full.costToCall), true);
}

console.log('only the players who actually bet get the value filter');
{
  const board = [c(9,0),c(10,1),c(11,2),c(2,3)];
  const hero: [Card, Card] = [c(12,1),c(8,0)]; // the nut straight
  function table(bettors: number, passive: number): GameState {
    const players: any[] = [
      { name: 'you', seatIndex: 0, stack: 1000, currentBet: 0, isActive: true, isYou: true },
    ];
    for (let i = 0; i < bettors; i++) {
      players.push({ name: 'b' + i, seatIndex: i + 1, stack: 0, currentBet: 1000, isActive: true, isYou: false });
    }
    for (let i = 0; i < passive; i++) {
      players.push({ name: 'p' + i, seatIndex: bettors + i + 1, stack: 5000, currentBet: 0, isActive: true, isYou: false });
    }
    return {
      holeCards: hero, communityCards: board, street: 'turn', pot: 2000,
      yourStack: 1000, yourCurrentBet: 0, costToCall: 1000, minRaise: 0,
      bigBlind: 20, smallBlind: 10, activePlayers: 1 + bettors + passive,
      position: 'BB', dealerSeatIndex: 1, availableActions: ['fold', 'call'], players,
    } as GameState;
  }

  expect('one bettor counts one', estimateOpponentSpec(table(1, 2)).valueOpponents, 1);
  expect('two bettors count two', estimateOpponentSpec(table(2, 1)).valueOpponents, 2);

  // Passive players must not drag our equity down as if they had shoved
  const withPassive = calculateEquity(hero, board, 3, ITERS,
    estimateOpponentSpec(table(1, 2))).equity;
  const allBetting = calculateEquity(hero, board, 3, ITERS,
    estimateOpponentSpec(table(3, 0))).equity;
  expect('two players who never bet cost us less than two who shoved',
    withPassive > allBetting, true);
  expectBetween('and the nut straight keeps a healthy estimate', withPassive, 0.68, 0.85);
}

console.log('the sampler delivers the weight it claims');
{
  // On a dry board only ~10% of hands make two pair, so a rejection loop
  // that gives up early silently under-delivers. With weight 1.0 the
  // opponent must ALWAYS qualify, and any leakage shows up as equity for a
  // hand that should have none.
  const board = [c(2,0),c(7,1),c(13,2),c(4,3),c(9,0)];
  const nothing: [Card, Card] = [c(12,1),c(11,2)];
  const leak = calculateEquity(nothing, board, 1, 30000,
    { percentile: 1, valueWeight: 1.0, minCategory: CATEGORY.TWO_PAIR, valueOpponents: 1 }).equity;
  expectBetween('near-zero leakage at full weight (was 4.65% at 16 retries)', leak, 0, 0.005);
}

console.log('a flop overbet says more than a pot-sized bet');
{
  /**
   * `betToPot` capped at 1.0 for the weight, and the flop had no size rule
   * for `minCategory` at all — so a third-pot stab and a 3x-pot overbet were
   * both modelled as "the value half is any pair". A value range containing
   * bottom pair is one that middle pair beats often enough to call, and
   * nobody overbets the flop with a pair of fours.
   *
   * Measured on 99 on T-5-4 facing 2x pot: 47% equity before, 27% after,
   * against a 40% price. It called an overbet with middle pair every time.
   */
  const potSized = valueSplitFor({ street: 'flop', betToPot: 1.0, allIn: false });
  const overBet = valueSplitFor({ street: 'flop', betToPot: 2.0, allIn: false });

  expect('a pot-sized flop bet can still be one pair', potSized.minCategory, CATEGORY.PAIR);
  expect('a flop overbet cannot', overBet.minCategory, CATEGORY.TWO_PAIR);
  expect('and is read as value more often', overBet.valueWeight > potSized.valueWeight, true);

  // The cap was the bug: size has to keep meaning something above pot
  const huge = valueSplitFor({ street: 'flop', betToPot: 5.0, allIn: false });
  expect('size still registers well above pot', huge.valueWeight > potSized.valueWeight, true);

  // ...without swallowing the ordinary c-bet sizes that are genuinely wide
  for (const betToPot of [0.33, 0.5, 0.75]) {
    const cbet = valueSplitFor({ street: 'flop', betToPot, allIn: false });
    expect(`a ${betToPot}x flop c-bet is still wide`, cbet.minCategory, CATEGORY.PAIR);
  }
}

process.exit(failures > 0 ? 1 : 0);
