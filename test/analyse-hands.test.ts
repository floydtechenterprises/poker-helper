/**
 * CLI-specific rendering only.
 *
 * The analysis itself — luck range, showdown comparison, blame attribution —
 * moved to src/data/analysis.ts so the popup and the CLI compute it from one
 * place, and is covered by analysis.test.ts. What is left here is the bit
 * that exists purely for the terminal: how chips get printed.
 */
import { fmt } from './analyse-hands';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('chips are never ambiguous');
{
  // toLocaleString rendered -2700 as "-2.700" on this machine, which reads
  // as minus two point seven — wrong by three orders of magnitude
  expect('thousands are grouped with spaces', fmt(-2700), '-2 700');
  expect('and never with dots or commas', /[.,]/.test(fmt(-1234567)), false);
  expect('wins carry a plus', fmt(1800), '+1 800');
  expect('small numbers are untouched', fmt(-45), '-45');
  expect('zero reads as a gain, not a loss', fmt(0), '+0');
  expect('millions group correctly', fmt(1234567), '+1 234 567');
}

process.exit(failures > 0 ? 1 : 0);
