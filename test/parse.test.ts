import { parseChipValue } from '../src/shared/parse';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('chip value parsing');

expect('plain integer', parseChipValue('9980'), 9980);
expect('comma thousands', parseChipValue('9,980'), 9980);
expect('period thousands (EU locale)', parseChipValue('9.980'), 9980);
expect('big comma thousands', parseChipValue('1,250,000'), 1250000);
expect('big period thousands', parseChipValue('1.250.000'), 1250000);
expect('decimal point', parseChipValue('12.5'), 12.5);
expect('decimal comma (EU)', parseChipValue('12,5'), 12.5);
expect('mixed: US style', parseChipValue('1,250.75'), 1250.75);
expect('mixed: EU style', parseChipValue('1.250,75'), 1250.75);
expect('with surrounding text', parseChipValue('Stack: 9,980 chips'), 9980);
expect('empty string', parseChipValue(''), 0);
expect('garbage', parseChipValue('abc'), 0);

process.exit(failures > 0 ? 1 : 0);
