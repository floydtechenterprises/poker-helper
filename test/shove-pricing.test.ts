/**
 * Pricing a call against an all-in, preflop.
 *
 * Both bugs here erred the same way — towards calling — which is the leak
 * the user reported from real play: "it keeps calling his all-ins".
 *
 *   1. The price ignored the uncallable overlay. A shove bigger than our
 *      stack has an excess that comes straight back to the shover; it sits
 *      in `pot` and can never be won. The postflop path priced this
 *      correctly for a while, this one did not.
 *   2. The opponent's shoving range was read as their VPIP — how often they
 *      ENTER a pot, counting limps and cold-calls at every stack depth. A
 *      shoving range is narrower and depth-dependent, and treating a 42%
 *      VPIP as a 42% shoving range inflates our equity against the one bet
 *      that costs a whole stack.
 */
import { shoveRangeFor } from '../src/engine/preflop/preflop-advisor';
import { defaultShoveRange, defaultCallRange, evaluateCallShove } from '../src/engine/preflop/push-fold';
import { effectiveCallPrice } from '../src/engine/pot-odds';
import { Card, Rank, Suit } from '../src/engine/types';

let failures = 0;
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });

console.log('\nshoving ranges widen as stacks get shorter');
{
  const shallow = defaultShoveRange(5);
  const mid = defaultShoveRange(12);
  const deep = defaultShoveRange(25);
  expectTrue('5bb shoves wider than 12bb', shallow > mid, `${shallow} vs ${mid}`);
  expectTrue('12bb shoves wider than 25bb', mid > deep, `${mid} vs ${deep}`);
  expectTrue('every value is a fraction',
    [shallow, mid, deep].every(v => v > 0 && v <= 1));

  // Monotonic across the whole range — a step function here made the
  // recommended range non-monotonic once before
  let monotonic = true;
  for (let bb = 2; bb < 40; bb++) {
    if (defaultShoveRange(bb + 1) > defaultShoveRange(bb) + 1e-9) monotonic = false;
  }
  expectTrue('never widens as stacks get deeper', monotonic);
}

console.log('\nVPIP nudges the shoving range but no longer decides it');
{
  const noRead = shoveRangeFor(10, null);
  const loose = shoveRangeFor(10, { handsTracked: 200, vpip: 0.55 });
  const tight = shoveRangeFor(10, { handsTracked: 200, vpip: 0.12 });

  expectTrue('a loose player is assumed to shove wider', loose > noRead, `${loose} vs ${noRead}`);
  expectTrue('a tight player narrower', tight < noRead, `${tight} vs ${noRead}`);

  /**
   * The point of the fix: VPIP must not BE the range. A 55% VPIP player is
   * not assumed to shove 55% of hands at 10bb.
   */
  expectTrue('a 55% VPIP is not read as a 55% shoving range',
    Math.abs(loose - 0.55) > 0.05, `${loose}`);

  expectTrue('too few hands falls back to the depth model',
    shoveRangeFor(10, { handsTracked: 4, vpip: 0.9 }) === noRead);
}

console.log('\nan uncallable shove is priced on what can actually be won');
{
  // They shove 11,100; we have 5,300. 5,800 comes straight back to them.
  const pot = 11_100 + 2_000;
  const priced = effectiveCallPrice(pot, 11_100, 5_300, 11_100, 0);

  const naiveNeeded = 5_300 / (pot + 5_300);
  const realNeeded = priced.toCall / (priced.contestedPot + priced.toCall);

  expectTrue('the real price is higher than the naive one',
    realNeeded > naiveNeeded, `${realNeeded} vs ${naiveNeeded}`);
  expectTrue('and the gap is worth acting on',
    realNeeded - naiveNeeded > 0.03, `${(realNeeded - naiveNeeded).toFixed(3)}`);
}

console.log('\ncalling a shove gets tighter when the price is honest');
{
  const hole: [Card, Card] = [c(9, 0), c(8, 0)];   // a marginal holding
  const cheap = evaluateCallShove({
    holeCards: hole, callCostBB: 10, potIfWeCallBB: 46, shoveRange: 0.5, iterations: 4000,
  });
  const honest = evaluateCallShove({
    holeCards: hole, callCostBB: 10, potIfWeCallBB: 22, shoveRange: 0.5, iterations: 4000,
  });
  expectTrue('a worse price needs more equity', honest.needed > cheap.needed);
  expectTrue('and the cheap price is more willing to call', cheap.ev > honest.ev);
}

console.log('\na tighter assumed shoving range makes us fold more');
{
  const hole: [Card, Card] = [c(10, 0), c(9, 1)];
  const vsWide = evaluateCallShove({
    holeCards: hole, callCostBB: 10, potIfWeCallBB: 24, shoveRange: 0.7, iterations: 4000,
  });
  const vsTight = evaluateCallShove({
    holeCards: hole, callCostBB: 10, potIfWeCallBB: 24, shoveRange: 0.15, iterations: 4000,
  });
  expectTrue('we have more equity against a wide shover',
    vsWide.equity > vsTight.equity, `${vsWide.equity} vs ${vsTight.equity}`);
}

console.log('\ncalling and shoving ranges stay sane relative to each other');
{
  // At every depth, people call shoves tighter than they shove
  let ok = true;
  for (let bb = 4; bb <= 30; bb += 2) {
    if (defaultCallRange(bb) > defaultShoveRange(bb)) ok = false;
  }
  expectTrue('nobody calls wider than they shove', ok);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall shove pricing tests passed');
