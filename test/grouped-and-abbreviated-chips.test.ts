/**
 * D5: chip text written with space thousands or a K/M suffix.
 *
 * The parser took the first run of digits, dots and commas, so "2 000"
 * came back as 2 and "1.5K" as 1.5 — a stack a thousand times too small,
 * which reads as all-in. Numbers that merely sit next to each other must
 * still not be glued together ("1950 +200" stays 1950).
 */
import { parseChipValue } from '../src/shared/parse';

let failures = 0;
function expect(name: string, actual: number, expected: number): void {
  if (Math.abs(actual - expected) < 1e-9) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('space-grouped thousands');
expect('"2 000"', parseChipValue('2 000'), 2000);
expect('"12 500"', parseChipValue('12 500'), 12500);
expect('"1 234 567"', parseChipValue('1 234 567'), 1234567);
expect('no-break space', parseChipValue('2\u00a0000'), 2000);
expect('narrow no-break space', parseChipValue('2\u202f000'), 2000);
expect('"CALL 2\\u202f000"', parseChipValue('CALL 2 000'), 2000);
expect('"Stack: 12\\u00a0500 chips"', parseChipValue('Stack: 12 500 chips'), 12500);

console.log('abbreviated amounts');
expect('"1.5K"', parseChipValue('1.5K'), 1500);
expect('"1.5k"', parseChipValue('1.5k'), 1500);
expect('"12K"', parseChipValue('12K'), 12000);
expect('"2.25M"', parseChipValue('2.25M'), 2250000);
expect('"1,5K" (decimal comma)', parseChipValue('1,5K'), 1500);

console.log('separate numbers are still not glued');
expect('"1950 +200"', parseChipValue('1950 +200'), 1950);
expect('"1950 200" (not a thousands group)', parseChipValue('1950 200'), 1950);
expect('"2 00" (not three digits)', parseChipValue('2 00'), 2);
expect('"2 0000" (not three digits)', parseChipValue('2 0000'), 2);
expect('"950 +200"', parseChipValue('950 +200'), 950);
expect('"950 200 chips" (ordinary space, not the whole text)', parseChipValue('950 200 chips'), 950);
expect('"5 then 2\\u202f000" takes the first number', parseChipValue('5 then 2 000'), 5);
expect('"25 BB" is not a suffix', parseChipValue('25 BB'), 25);
expect('"10 kings" is not a suffix', parseChipValue('10 kings'), 10);
expect('"5Kg" is not a suffix', parseChipValue('5Kg'), 5);

console.log('existing forms unchanged');
expect('"9,980"', parseChipValue('9,980'), 9980);
expect('"9.980"', parseChipValue('9.980'), 9980);
expect('"12,5"', parseChipValue('12,5'), 12.5);
expect('"1,250.75"', parseChipValue('1,250.75'), 1250.75);

process.exit(failures > 0 ? 1 : 0);
