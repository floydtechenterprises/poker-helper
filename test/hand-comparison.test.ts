/**
 * Comparing two finished hands.
 *
 * The existing differential proves the fast and slow evaluators AGREE. It
 * cannot prove they are right, because agreeing on the same wrong kicker
 * still agrees. Equity is counted as wins/ties/losses from exactly these
 * comparisons, so a mis-ranked kicker or a split pot scored as a win moves
 * every number the advisor shows.
 *
 * Ties get their own section. A tie is not a rounding detail here — the
 * Monte Carlo counts them separately and halves them, so two players
 * playing the board MUST produce byte-identical scores. Encoding a kicker
 * that "should not matter" would silently convert chops into wins and
 * inflate equity.
 */
import { evaluate5, evaluate7 } from '../src/engine/hand-evaluator';
import { Card, Rank, Suit } from '../src/engine/types';

let failures = 0;
const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });
const S = 3, H = 2, D = 1, C = 0;

const score = (h: Card[]) => (h.length === 7 ? evaluate7(h) : evaluate5(h));

function beats(name: string, win: Card[], lose: Card[]): void {
  const a = score(win), b = score(lose);
  if (a > b) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: ${a} should beat ${b}`); failures++; }
}
function ties(name: string, x: Card[], y: Card[]): void {
  const a = score(x), b = score(y);
  if (a === b) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: ${a} vs ${b} — should be identical`); failures++; }
}

console.log('\nkickers decide, at every depth');
beats('pair: better first kicker',
  [c(9, S), c(9, H), c(14, D), c(5, C), c(3, S)], [c(9, D), c(9, C), c(13, D), c(5, H), c(3, H)]);
beats('pair: third kicker still counts',
  [c(9, S), c(9, H), c(14, D), c(5, C), c(4, S)], [c(9, D), c(9, C), c(14, H), c(5, H), c(3, H)]);
beats('trips: kicker decides',
  [c(9, S), c(9, H), c(9, D), c(14, C), c(3, S)], [c(9, C), c(9, S), c(9, H), c(13, C), c(3, H)]);
beats('quads: kicker decides',
  [c(9, S), c(9, H), c(9, D), c(9, C), c(14, S)], [c(9, S), c(9, H), c(9, D), c(9, C), c(13, S)]);

console.log('\ntwo pair compares top, then second, then kicker');
beats('higher top pair',
  [c(13, S), c(13, H), c(2, D), c(2, C), c(9, S)], [c(12, S), c(12, H), c(11, D), c(11, C), c(9, H)]);
beats('same top, higher second — beats a better kicker',
  [c(13, S), c(13, H), c(12, D), c(12, C), c(2, S)], [c(13, D), c(13, C), c(11, D), c(11, H), c(14, S)]);
beats('both pairs equal, kicker decides',
  [c(13, S), c(13, H), c(12, D), c(12, C), c(14, S)], [c(13, D), c(13, C), c(12, S), c(12, H), c(9, S)]);

console.log('\nflushes compare card by card');
beats('ace-high over king-high',
  [c(14, S), c(9, S), c(7, S), c(5, S), c(3, S)], [c(13, H), c(12, H), c(9, H), c(5, H), c(3, H)]);
beats('same top, second card decides',
  [c(14, S), c(13, S), c(7, S), c(5, S), c(3, S)], [c(14, H), c(12, H), c(9, H), c(5, H), c(3, H)]);
beats('down to the fifth card',
  [c(14, S), c(13, S), c(7, S), c(5, S), c(4, S)], [c(14, H), c(13, H), c(7, H), c(5, H), c(3, H)]);

console.log('\nfull houses compare trips first');
beats('bigger trips beat bigger pair',
  [c(9, S), c(9, H), c(9, D), c(2, C), c(2, S)], [c(8, S), c(8, H), c(8, D), c(14, C), c(14, S)]);
beats('same trips, higher pair',
  [c(9, S), c(9, H), c(9, D), c(14, C), c(14, S)], [c(9, C), c(9, S), c(9, H), c(13, C), c(13, S)]);

console.log('\nstraights, including the wheel being the worst one');
beats('six-high beats the wheel',
  [c(6, S), c(5, H), c(4, D), c(3, C), c(2, S)], [c(14, S), c(2, H), c(3, D), c(4, C), c(5, S)]);
beats('higher straight flush wins',
  [c(10, S), c(9, S), c(8, S), c(7, S), c(6, S)], [c(9, H), c(8, H), c(7, H), c(6, H), c(5, H)]);
beats('a straight flush beats quads',
  [c(10, S), c(9, S), c(8, S), c(7, S), c(6, S)], [c(14, S), c(14, H), c(14, D), c(14, C), c(13, S)]);

console.log('\nsplit pots must be byte-identical, not merely close');
{
  const broadway = [c(14, S), c(13, H), c(12, D), c(11, C), c(10, S)];
  ties('both players play the board',
    [c(2, C), c(3, D), ...broadway], [c(4, H), c(5, S), ...broadway]);

  const paired = [c(9, S), c(9, H), c(5, D), c(3, C), c(2, S)];
  ties('same pair, same kickers, different suits',
    [c(14, D), c(13, C), ...paired], [c(14, H), c(13, S), ...paired]);

  ties('identical five-card hands in different suits',
    [c(9, S), c(9, H), c(14, D), c(5, C), c(3, S)], [c(9, D), c(9, C), c(14, H), c(5, S), c(3, H)]);
}

console.log('\ncategories rank in the right order');
{
  const ladder: [string, Card[]][] = [
    ['high card', [c(14, S), c(13, H), c(12, D), c(11, C), c(9, S)]],
    ['pair', [c(14, S), c(14, H), c(12, D), c(11, C), c(9, S)]],
    ['two pair', [c(14, S), c(14, H), c(12, D), c(12, C), c(9, S)]],
    ['trips', [c(14, S), c(14, H), c(14, D), c(12, C), c(9, S)]],
    ['straight', [c(10, S), c(9, H), c(8, D), c(7, C), c(6, S)]],
    ['flush', [c(14, S), c(13, S), c(12, S), c(11, S), c(9, S)]],
    ['full house', [c(14, S), c(14, H), c(14, D), c(12, C), c(12, S)]],
    ['quads', [c(14, S), c(14, H), c(14, D), c(14, C), c(12, S)]],
    ['straight flush', [c(10, S), c(9, S), c(8, S), c(7, S), c(6, S)]],
  ];
  let prev = -1;
  for (const [name, hand] of ladder) {
    const v = evaluate5(hand);
    if (v > prev) console.log(`  PASS ${name} outranks everything below it`);
    else { console.error(`  FAIL ${name} does not outrank the previous category`); failures++; }
    prev = v;
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall hand comparison tests passed');
