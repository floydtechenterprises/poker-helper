/**
 * D6: we are recognised in the log however the table spells our name.
 *
 * The seat name (from the table) and the log's names (from its text) were
 * compared exactly. When capitalisation or spacing differed, our own cards
 * were filed as an opponent's showdown, our net read 0, and every flag about
 * what we did came back false.
 */
import { logNameFor } from '../src/content/controller';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const log = ['Rrr', 'noob'];
console.log('\nour name');
expect('matched across capitalisation', logNameFor('rrr', log), 'Rrr');
expect('matched across spacing', logNameFor('  rrr ', log), 'Rrr');
expect('returned as the log spells it, to look the hand up', logNameFor('RRR', log), 'Rrr');
expect('not matched to someone else', logNameFor('mike', log), undefined);
expect('unknown when the table has none', logNameFor(undefined, log), undefined);

console.log(failures > 0 ? `\n${failures} hero-name test(s) failed` : '\nall hero-name tests passed');
process.exit(failures > 0 ? 1 : 0);
