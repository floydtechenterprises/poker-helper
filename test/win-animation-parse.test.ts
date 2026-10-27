/**
 * A winning stack renders as "1950 +200" on the parent element — and the
 * stack fallback selector points at exactly that parent, for use when the
 * inner `.normal-value` is missing, which is precisely when the win animation
 * is running. The comment on YOUR_STACK even says the parent "carries the win
 * animation which would parse as garbage"; the fallback then used it anyway.
 *
 * `parseChipValue` stripped every non-digit and glued what was left together:
 *
 *   "1950 +200"  -> 1950200   a thousandfold overstatement
 *   "2,450 -100" -> 2.45      a full stack read as two and a half chips
 *
 * Neither threw. Neither looked wrong on screen. The first makes SPR enormous
 * and the effective-stack cap meaningless; the second reads as all-in.
 */
import { parseChipValue } from '../src/shared/parse';

let failures = 0;
function near(name: string, actual: number, expected: number): void {
  if (Math.abs(actual - expected) < 1e-9) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\nthe win animation does not inflate the stack');
{
  near('a plain stack', parseChipValue('1950'), 1950);
  near('with a win overlay', parseChipValue('1950 +200'), 1950);
  near('with no space', parseChipValue('1950+200'), 1950);
  near('with a loss overlay', parseChipValue('2,450 -100'), 2450);
  near('across a line break', parseChipValue('1950\n +200'), 1950);
}

console.log('\nboth separator conventions still work');
{
  near('comma thousands', parseChipValue('1,200'), 1200);
  near('dot thousands', parseChipValue('9.980'), 9980);
  near('dot decimal', parseChipValue('1.5'), 1.5);
  near('comma decimal', parseChipValue('12,5'), 12.5);
  near('millions', parseChipValue('9,999,999'), 9999999);
}

console.log('\nnothing parseable is zero, not a guess');
{
  near('empty', parseChipValue(''), 0);
  near('letters only', parseChipValue('abc'), 0);
  near('punctuation only', parseChipValue('---'), 0);
}

/*
 * A section reading the call button was here. It mocked PokerNow markup,
 * where a button could read "CALL 2 000" and the old pattern stopped at
 * the first digit, pricing a two-thousand chip call at two. duel.com puts
 * the amount in its own element, so the hazard does not arise there and
 * the case belongs with the reader rather than the parser.
 *
 * The grouping behaviour it exercised is still covered by
 * grouped-and-abbreviated-chips.test.ts.
 */

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall win animation parse tests passed');
