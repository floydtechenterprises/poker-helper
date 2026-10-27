/**
 * L7: the per-opponent history eases in, as its comment promises.
 *
 * "Between there and this, the two are blended in proportion, so the
 * parameters slide across instead of jumping the moment a counter ticks past
 * a threshold." The weight was 0 below MIN_DECISIONS and n / FULL above it —
 * so the 25th decision against a player moved it from 0 to 0.5 in one hand,
 * and every learned dial with it.
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS, FULL_OPPONENT_WEIGHT } from '../src/engine/learning';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

function weightAt(n: number): number {
  const engine = new LearningEngine();
  (engine as unknown as { opponentStats: unknown }).opponentStats = { totalDecisions: n } as unknown;
  return engine.opponentWeight();
}

console.log('\nthe weight by decisions against him');
{
  const series = Array.from({ length: FULL_OPPONENT_WEIGHT + 5 }, (_, n) => weightAt(n));
  const biggest = Math.max(...series.slice(1).map((v, i) => v - series[i]));
  check(`no single decision moves it more than a step (${biggest.toFixed(3)})`,
    biggest <= 1 / (FULL_OPPONENT_WEIGHT - MIN_DECISIONS) + 1e-9,
    series.map(v => v.toFixed(2)).join(' '));
  check('nothing below the minimum sample', weightAt(MIN_DECISIONS - 1) === 0);
  check('full weight at the full sample', weightAt(FULL_OPPONENT_WEIGHT) === 1);
  check('never decreasing', series.every((v, i) => i === 0 || v >= series[i - 1]));
}

console.log(failures > 0 ? `\n${failures} weight test(s) failed` : '\nall weight tests passed');
process.exit(failures > 0 ? 1 : 0);
