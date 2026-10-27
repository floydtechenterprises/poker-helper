/**
 * Folding is its own outcome.
 *
 * `HandRecord` has always declared a 'fold' result and nothing ever assigned
 * it. Hands were labelled purely by chip change, so the same decision split
 * across two buckets depending on where you were sitting: folding the button
 * costs nothing and recorded as 'unknown', folding the big blind costs a
 * blind and recorded as 'loss'. That also meant 'unknown' stopped meaning
 * "we could not tell", which is the only thing it should mean.
 */
import { classifyHandResult } from '../src/content/controller';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('folds are labelled as folds, wherever you were sitting');
{
  // The exact case from the exported history: folded the button, no chips in
  expect('button fold (net 0) is a fold, not unknown',
    classifyHandResult(0, true), 'fold');
  // The same decision one seat over, having posted a blind
  expect('big blind fold (net -20) is a fold, not a loss',
    classifyHandResult(-20, true), 'fold');
  expect('folding after betting a lot is still a fold',
    classifyHandResult(-1500, true), 'fold');
}

console.log('hands you played to the end are unaffected');
{
  expect('winning chips is a win', classifyHandResult(500, false), 'win');
  expect('losing chips is a loss', classifyHandResult(-500, false), 'loss');
  expect('a chopped pot is neither', classifyHandResult(0, false), 'unknown');
}

console.log('unknown now means only what it says');
{
  // The graphics path when our own seat could not be read at all
  expect('an unreadable seat with no chip change is unknown',
    classifyHandResult(0, undefined), 'unknown');
  // Chip change still tells us something even without a fold signal
  expect('an unreadable seat that won is still a win',
    classifyHandResult(300, undefined), 'win');
  expect('an unreadable seat that lost is still a loss',
    classifyHandResult(-300, undefined), 'loss');
}

console.log('a fold outranks the chip change that came with it');
{
  // Winning chips while folded is contradictory input; the fold is the
  // stated fact and the net is inferred, so the fact wins
  expect('folded takes precedence', classifyHandResult(999, true), 'fold');
}

console.log('the result is always one of the four declared values');
{
  const allowed = ['win', 'loss', 'fold', 'unknown'];
  let bad = 0;
  for (const net of [-1e6, -20, -1, 0, 1, 20, 1e6, NaN]) {
    for (const folded of [true, false, undefined]) {
      const r = classifyHandResult(net, folded);
      if (!allowed.includes(r)) bad++;
    }
  }
  expect('24 combinations all produce a declared value', bad, 0);
  // NaN must not silently become a win or a loss
  expect('a NaN net without a fold is unknown',
    classifyHandResult(NaN, false), 'unknown');
}

process.exit(failures > 0 ? 1 : 0);
