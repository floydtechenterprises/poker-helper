/**
 * The equity pool sizes itself to the machine it is running on.
 *
 * It was a flat 2 workers everywhere. Equity is the slow part of a decision —
 * a Monte Carlo over thousands of runouts, split across the pool — so a
 * 24-core desktop ran the same two workers as a laptop and answered several
 * times slower than it could.
 *
 * Cores minus two leaves the page's thread and the browser one each. The
 * bound at the top is deliberate: past it the messaging costs more than the
 * extra parallelism returns for one short burst of work.
 */
import { equityWorkerCount, WORKER_COUNT, MAX_WORKERS } from '../src/shared/constants';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\nbigger machines get more workers');
{
  check('a 4-core laptop runs the floor', equityWorkerCount(4) === 2, String(equityWorkerCount(4)));
  check('an 8-core machine runs 6', equityWorkerCount(8) === 6, String(equityWorkerCount(8)));
  check('a 32-thread desktop is capped, not unbounded',
    equityWorkerCount(32) === MAX_WORKERS, String(equityWorkerCount(32)));
  check('more cores never means fewer workers',
    [2, 4, 6, 8, 12, 16, 24, 32, 128].every((c, i, all) =>
      i === 0 || equityWorkerCount(c) >= equityWorkerCount(all[i - 1])));
}

console.log('\nand it never asks for a pool it cannot use');
{
  check('two cores still leave a working pool', equityWorkerCount(2) === WORKER_COUNT);
  check('one core too', equityWorkerCount(1) === WORKER_COUNT);
  // Not `undefined`: that is the argument's default, which reads the real
  // machine. The no-navigator path is the default itself, and it yields the
  // same floor through these values.
  for (const unknown of [0, NaN, Infinity]) {
    check(`a machine reporting ${String(unknown)} falls back to the floor`,
      equityWorkerCount(unknown) === WORKER_COUNT);
  }
  check('and asking the machine itself gives a usable pool',
    equityWorkerCount() >= WORKER_COUNT && equityWorkerCount() <= MAX_WORKERS,
    String(equityWorkerCount()));
  check('every answer is a whole number',
    [1, 3, 7, 9, 15].every(c => Number.isInteger(equityWorkerCount(c))));
}

if (failures > 0) { console.error(`\n${failures} worker-count test(s) failed`); process.exit(1); }
console.log('\nall worker-count tests passed');
