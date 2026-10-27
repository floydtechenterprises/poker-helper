/**
 * Self-play found bluffing with air was the ONLY losing action in the whole
 * strategy (flop air bets -1.99 bb/hand, turn air bets -0.33 over 961
 * spots). The cause: bluff decisions checked board texture, position and
 * player count, but never whether the opponent folds.
 *
 * These lock the break-even maths in place.
 */
import { evaluateBluff } from '../src/engine/postflop/bluff-gate';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectNear(name: string, actual: number, expected: number, tol = 0.02): void {
  if (Math.abs(actual - expected) <= tol) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ~${expected}, got ${actual}`); failures++; }
}

console.log('break-even maths for a pure bluff');
{
  // Half-pot bluff risks 50 to win 100 → needs to work 1 in 3 times
  const r = evaluateBluff(100, 50, 0.5, 0);
  expectNear('half-pot needs ~33% folds', r.needed, 0.333);
  expect('50% folds clears it', r.profitable, true);
}
{
  const r = evaluateBluff(100, 100, 0.5, 0);
  expectNear('pot-sized needs ~50% folds', r.needed, 0.5);
  expect('exactly break-even is not profitable', r.profitable, false);
}

console.log('the leak: bluffing into people who do not fold');
{
  // A calling station folds ~15% — no bluff size rescues that
  for (const size of [0.33, 0.5, 0.75, 1.0]) {
    const r = evaluateBluff(100, 100 * size, 0.15, 0);
    expect(`${size}x pot bluff into a station is refused`, r.profitable, false);
  }
}
{
  const r = evaluateBluff(100, 50, 0.15, 0);
  expect('and it explains why in plain terms',
    r.reason.includes('needs') && r.reason.includes('only fold'), true);
}

console.log('bluffs into folders are still allowed');
{
  const r = evaluateBluff(100, 50, 0.7, 0);
  expect('70% folders make a half-pot bluff clearly profitable', r.profitable, true);
}

console.log('backup equity lowers the bar (semi-bluffs)');
{
  const pure = evaluateBluff(100, 60, 0.35, 0);
  const semi = evaluateBluff(100, 60, 0.35, 0.35); // a strong draw
  expect('pure air at 35% folds is refused', pure.profitable, false);
  expect('the same spot with a draw is fine', semi.profitable, true);
  expect('and the required fold rate drops', semi.needed < pure.needed, true);
}
{
  // A hand with enough equity to be +EV even when called never needs folds
  const r = evaluateBluff(100, 50, 0.1, 0.6);
  expectNear('needs 0% folds when the call itself is profitable', r.needed, 0);
  expect('so it fires regardless of fold equity', r.profitable, true);
}

console.log('degenerate inputs are safe');
expect('no pot means no bluff', evaluateBluff(0, 50, 0.9, 0).profitable, false);
expect('no bet means no bluff', evaluateBluff(100, 0, 0.9, 0).profitable, false);

process.exit(failures > 0 ? 1 : 0);
