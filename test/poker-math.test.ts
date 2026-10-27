/**
 * Pot odds, SPR and effective stacks — the arithmetic every decision rests on.
 *
 * These are pure functions, so the risk is not crashes but quietly wrong
 * numbers: a price that reads ten points low always errs towards calling,
 * and nothing downstream can tell.
 */
import { effectiveCallPrice, calculatePotOdds, bluffBreakEven, calculateBetEV } from '../src/engine/pot-odds';
import { analyzeSPR, getEffectiveStack } from '../src/engine/spr';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function near(name: string, actual: number, expected: number, tol = 0.005): void {
  if (Math.abs(actual - expected) <= tol) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ~${expected}, got ${actual}`); failures++; }
}
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

console.log('\npot odds are the price of the call');
{
  // Pot 100 already includes their 50 bet; calling 50 makes it 150 to win
  near('half-pot bet needs 25% equity',
    calculatePotOdds(150, 50, 0.5, 1000, { street: 'river' }).potOdds, 50 / 200);
  near('pot-sized bet needs 33%',
    calculatePotOdds(200, 100, 0.5, 1000, { street: 'river' }).potOdds, 100 / 300);
  expect('a free card costs nothing',
    calculatePotOdds(100, 0, 0.3, 1000, { street: 'flop' }).potOdds, 0);
}

console.log('\nMDF is the mirror of the price');
{
  // Pot-sized bet: pot before was 100, bet 100 -> defend 50%
  // Half-pot: before 100, bet 50 -> defend 2/3
}

console.log('\nan uncallable overlay never contests the pot');
{
  /**
   * They shove 11,100 into our 5,300. The 5,800 they cannot be called on
   * comes straight back to them — it is in `pot` but can never be won, and
   * `costToCall` says nothing about it. Counting it made the call look
   * cheaper than it is, always in the direction of calling.
   */
  const priced = effectiveCallPrice(11_100 + 2_000, 11_100, 5_300, 11_100, 0);
  expect('we can only ever pay our stack', priced.toCall, 5_300);
  expectTrue('the pot is reduced by what they get back',
    priced.contestedPot < 11_100 + 2_000,
    `${priced.contestedPot}`);
  expectTrue('the price is higher than the naive one',
    priced.price > 5_300 / (11_100 + 2_000 + 5_300),
    `${priced.price}`);
}

console.log('\nnormal bets are unaffected by the overlay logic');
{
  const priced = effectiveCallPrice(300, 100, 5_000, 100, 0);
  expect('nothing comes back', priced.contestedPot, 300);
  expect('we pay the full ask', priced.toCall, 100);
  near('and the price is ordinary', priced.price, 100 / 400);
}

console.log('\nbluff break-even is bet over bet-plus-pot');
{
  near('third-pot bluff needs 25%', bluffBreakEven(100, 33.3), 0.25, 0.01);
  near('pot-sized bluff needs 50%', bluffBreakEven(100, 100), 0.5);
  near('double-pot bluff needs 66%', bluffBreakEven(100, 200), 2 / 3);
}

console.log('\nbetting EV accounts for fold equity and the call');
{
  // Never called, always folds: we win the pot outright
  near('pure fold equity wins the pot', calculateBetEV(100, 50, 1, 0), 100);
  // Always called with zero equity: we lose our bet
  near('always called with nothing loses the bet', calculateBetEV(100, 50, 0, 0), -50);
  // Always called with certain victory: we win pot plus their call
  near('always called with the nuts', calculateBetEV(100, 50, 0, 1), 150);
}

console.log('\nSPR categories follow the stack behind');
{
  expect('twice the pot is committed', analyzeSPR(200, 100).category, 'committed');
  expect('five times is shallow', analyzeSPR(500, 100).category, 'shallow');
  expect('ten times is medium', analyzeSPR(1000, 100).category, 'medium');
  expect('twenty times is deep', analyzeSPR(2000, 100).category, 'deep');
  expect('no pot yet is deep', analyzeSPR(1000, 0).category, 'deep');
}

console.log('\neffective stack is what can actually go in');
{
  expect('capped by the biggest opponent', getEffectiveStack(1000, [400, 200]), 400);
  expect('capped by our own stack', getEffectiveStack(300, [4000, 2000]), 300);
  expect('no opponents listed keeps our stack', getEffectiveStack(1000, []), 1000);

  /**
   * Everyone still in the hand is already all-in. Nothing more can go in, so
   * the stack behind is irrelevant — this used to return our full stack and
   * report a very deep SPR ("speculative hands gain value") at the exact
   * moment the hand had become a pure showdown.
   */
  expect('opponents present but all-in leaves nothing behind',
    getEffectiveStack(1000, [0, 0]), 0);
  expect('and that reads as committed', analyzeSPR(getEffectiveStack(1000, [0]), 500).category, 'committed');
}

console.log('\nposition and street change how much equity is realised');
{
  const oop = calculatePotOdds(200, 100, 0.5, 1000, { street: 'flop', hasPosition: false });
  const ip = calculatePotOdds(200, 100, 0.5, 1000, { street: 'flop', hasPosition: true });
  expectTrue('in position realises more', ip.realizedEquity > oop.realizedEquity);

  const river = calculatePotOdds(200, 100, 0.5, 1000, { street: 'river', hasPosition: false });
  expect('the river realises everything — no cards to come', river.realizedEquity, 0.5);

  const heads = calculatePotOdds(200, 100, 0.5, 1000, { street: 'flop', numOpponents: 1 });
  const multi = calculatePotOdds(200, 100, 0.5, 1000, { street: 'flop', numOpponents: 3 });
  expectTrue('multiway realises less', multi.realizedEquity < heads.realizedEquity);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall poker math tests passed');
