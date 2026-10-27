/**
 * Counting the hands the opponent can still hold.
 *
 * Combinatorics is exactly checkable, so these tests assert real numbers
 * rather than ranges. If the count is off by even one the arithmetic is
 * wrong, and a combo argument that is approximately right is worth nothing —
 * its only advantage over the equity number is that it is exact.
 */
import {
  countCombos, remainingCombos, deadRanks, describeCombos, comboGuard, setComboGuard,
  guardFirings, resetGuardFirings,
} from '../src/engine/combos';
import { Card, Rank } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const c = (rank: number, suit: number): Card => ({ rank: rank as Rank, suit: suit as any });

console.log('the remaining deck is exactly what we cannot see');
{
  const ours: [Card, Card] = [c(14, 0), c(14, 1)];
  const board = [c(12, 0), c(12, 1), c(12, 2), c(7, 3), c(2, 0)];
  const combos = remainingCombos(ours, board);
  // 52 - 2 hole - 5 board = 45 cards, C(45,2) = 990
  check('990 combinations remain after seven visible cards',
    combos.length === 990, `got ${combos.length}`);

  // No combination may contain a card we can see
  const seen = new Set([...ours, ...board].map(x => x.rank * 4 + x.suit));
  const leaked = combos.filter(
    ([a, b]) => seen.has(a.rank * 4 + a.suit) || seen.has(b.rank * 4 + b.suit),
  ).length;
  check('no combination uses a visible card', leaked === 0,
    `${leaked} combinations contained a card already in play`);

  // And no combination may repeat a card
  const dupes = combos.filter(([a, b]) => a.rank === b.rank && a.suit === b.suit).length;
  check('no combination repeats a card', dupes === 0);
}

console.log('three of a rank on the board really does kill it');
{
  // Board: Q Q Q 7 2 — one queen left in the deck
  const board = [c(12, 0), c(12, 1), c(12, 2), c(7, 3), c(2, 0)];
  const ours: [Card, Card] = [c(5, 0), c(5, 1)];

  const dead = deadRanks(ours, board);
  const queens = dead.find(d => d.rank === 12);
  check('the queens are flagged as nearly gone', queens !== undefined);
  check('exactly one queen remains', queens?.remaining === 1,
    `reported ${queens?.remaining} remaining`);

  // Holding a queen ourselves would leave none
  const withQueen = deadRanks([c(12, 3), c(5, 0)], board);
  check('holding the last queen leaves none',
    withQueen.find(d => d.rank === 12)?.remaining === 0);
}

console.log('the user\'s hand: fives full of queens on a queens board');
{
  // Board QQQ72, we hold 55 — a full house, queens full of fives... no:
  // three queens plus our pair of fives is a full house, QQQ55.
  const board = [c(12, 0), c(12, 1), c(12, 2), c(7, 3), c(2, 0)];
  const ours: [Card, Card] = [c(5, 0), c(5, 1)];

  const count = countCombos(ours, board);
  check('a count is produced on a complete board', count !== null);
  if (count) {
    check('the three buckets add up to the total',
      count.beatsUs + count.weBeat + count.ties === count.total,
      `${count.beatsUs}+${count.weBeat}+${count.ties} != ${count.total}`);
    console.log(`  beats us: ${count.beatsUs}, we beat: ${count.weBeat}, ties: ${count.ties}`);

    /**
     * The result that makes the whole exercise worthwhile.
     *
     * A full house on a three-queen board FEELS unbeatable, and 21% of the
     * hands he can hold beat it — because the board pairs the seven, so any
     * seven in his hand is queens full of sevens, and every pocket pair
     * above fives is better too. That is not visible from looking at the
     * board, and it is exactly countable.
     */
    check('a small full house is beaten far more often than it looks',
      count.beatsUs === 212,
      `expected 212 combinations to beat queens full of fives, got ${count.beatsUs}`);
  }

  /**
   * The ordering has to be right, or the count is decoration.
   *
   * Same board, better full houses, strictly fewer hands beating us — and
   * aces are beaten by EXACTLY the 44 combinations containing the one queen
   * left in the deck, which is a number that can be checked by hand:
   * one queen paired with each of the other 44 unseen cards.
   */
  const beaten = (hole: [Card, Card]) => countCombos(hole, board)!.beatsUs;
  const fives = beaten([c(5, 0), c(5, 1)]);
  const eights = beaten([c(8, 0), c(8, 1)]);
  const aces = beaten([c(14, 0), c(14, 1)]);

  check('a better full house is beaten less often',
    aces < eights && eights < fives,
    `aces ${aces}, eights ${eights}, fives ${fives}`);
  check('queens full of aces is beaten by exactly the 44 quad combinations',
    aces === 44, `got ${aces}`);
}

console.log('the nuts is beaten by nothing');
{
  // Royal flush in spades on the board plus our hand — unbeatable
  const board = [c(14, 3), c(13, 3), c(12, 3), c(11, 3), c(10, 3)];
  const ours: [Card, Card] = [c(2, 0), c(3, 1)];
  const count = countCombos(ours, board);
  // Everyone plays the board, so everything ties
  check('a board royal flush ties with everything',
    count !== null && count.beatsUs === 0,
    `${count?.beatsUs} combinations beat the nuts`);
}

console.log('the worst hand is beaten by almost everything');
{
  // Board with no help, we hold the two worst cards
  const board = [c(14, 0), c(13, 1), c(12, 2), c(11, 3), c(9, 0)];
  const ours: [Card, Card] = [c(2, 1), c(3, 2)];
  const count = countCombos(ours, board);
  check('playing the board loses to most holdings',
    count !== null && count.fractionAhead > 0.3,
    `only ${((count?.fractionAhead ?? 0) * 100).toFixed(1)}% beat us`);
}

console.log('nothing is claimed before the river');
{
  const ours: [Card, Card] = [c(14, 0), c(14, 1)];
  check('no count on the flop', countCombos(ours, [c(2, 0), c(3, 1), c(4, 2)]) === null);
  check('no count on the turn', countCombos(ours, [c(2, 0), c(3, 1), c(4, 2), c(5, 3)]) === null);
  check('no count preflop', countCombos(ours, []) === null);

}

console.log('the description stays quiet unless it has something to say');
{
  const board = [c(12, 0), c(12, 1), c(12, 2), c(7, 3), c(2, 0)];
  const strong = countCombos([c(5, 0), c(5, 1)], board);
  const note = describeCombos(strong, deadRanks([c(5, 0), c(5, 1)], board));
  check('a lopsided spot produces a note', note !== null, 'said nothing');
  if (note) {
    console.log(`  "${note}"`);
    check('and it mentions the dead queens', note.includes('queen'));
  }

  /**
   * A genuinely middling spot must stay silent.
   *
   * The first attempt at this used nine-high on an ace-king board, which is
   * beaten by 957 of 990 holdings — lopsided, so the note fired and the test
   * failed. That was the test being wrong rather than the code, and it is
   * worth keeping the correction visible: "middling" has to be verified, not
   * assumed, or the assertion tests nothing.
   *
   * A middle pair on an unpaired board is beaten about a third of the time,
   * which is the ordinary case this must not comment on.
   */
  const midBoard = [c(14, 2), c(13, 3), c(7, 0), c(4, 1), c(2, 2)];
  const plain = countCombos([c(9, 0), c(9, 1)], midBoard);
  check('the middling spot really is middling',
    plain !== null && plain.fractionAhead > 0.2 && plain.fractionAhead < 0.5,
    `${((plain?.fractionAhead ?? 0) * 100).toFixed(1)}% — not a middling spot, so the test proves nothing`);
  const quiet = describeCombos(plain, deadRanks([c(9, 0), c(9, 1)], midBoard));
  check('and it says nothing', quiet === null, `said: ${quiet}`);
}

/**
 * Every rank name must survive being turned singular.
 *
 * The plural was singularised with `replace(/e?s$/, '')`, which is correct
 * for "queens" and silently wrong for every name whose singular ends in a
 * vowel: aces became "ac", fives "fiv", nines "nin", threes "thre". Four of
 * thirteen ranks were broken, the tests all passed, and the only place it
 * showed was a sentence the user would read mid-hand.
 */
console.log('every rank reads correctly in both forms');
{
  const board5 = (r: number) => [c(r, 0), c(r, 1), c(r, 2), c(8, 3), c(2, 0)];
  const bad: string[] = [];
  for (let r = 2; r <= 14; r++) {
    // Skip the ranks already used as filler in the board above
    const filler: [Card, Card] = r === 8 || r === 2
      ? [c(5, 1), c(4, 2)] : [c(8, 0), c(2, 1)];
    if (r === 8 || r === 2) continue;
    const note = describeCombos(
      countCombos(filler, board5(r)), deadRanks(filler, board5(r)),
    );
    if (!note) { bad.push(`rank ${r}: no note at all`); continue; }
    // A truncated name is one that is not a real word we listed
    const words = ['ace', 'king', 'queen', 'jack', 'ten', 'nine', 'eight',
      'seven', 'six', 'five', 'four', 'three', 'two'];
    const m = note.match(/only one (\w+) left/);
    if (!m) { bad.push(`rank ${r}: no singular phrase in "${note}"`); continue; }
    if (!words.includes(m[1])) bad.push(`rank ${r}: produced "${m[1]}"`);
  }
  check('no rank name is mangled when singularised', bad.length === 0,
    bad.join('; '));
}

console.log('a duplicate card is refused, not counted');
{
  let threw = false;
  try {
    // The same ace in our hand and on the board — an impossible deck
    countCombos([c(14, 0), c(13, 1)], [c(14, 0), c(7, 2), c(4, 3), c(3, 0), c(2, 1)]);
  } catch { threw = true; }
  check('duplicated cards throw rather than produce a plausible count', threw,
    'counted an impossible deck and returned a number nobody could tell was wrong');
}

/**
 * "Nothing beats you" and "everyone chops" are not the same sentence.
 *
 * A board royal flush leaves `beatsUs` at zero — and `weBeat` at zero too,
 * because every holding ties. Reporting only the first reads as the nuts and
 * invites a raise into a pot that cannot be won.
 */
console.log('a board that plays is not the nuts');
{
  const board = [c(14, 3), c(13, 3), c(12, 3), c(11, 3), c(10, 3)];
  const ours: [Card, Card] = [c(2, 0), c(3, 1)];
  const count = countCombos(ours, board)!;
  check('nothing beats us and nothing loses to us',
    count.beatsUs === 0 && count.weBeat === 0,
    `beats ${count.beatsUs}, we beat ${count.weBeat}`);

  const note = describeCombos(count, deadRanks(ours, board));
  check('the note says the board plays',
    note !== null && note.includes('chop'),
    `said: ${note}`);
  check('and does not claim we hold the nuts',
    note !== null && !note.includes('Nothing he can hold beats you'),
    `said: ${note}`);
}

console.log('quads on the board read as English');
{
  // All four sixes visible on the board
  const board = [c(6, 0), c(6, 1), c(6, 2), c(6, 3), c(9, 0)];
  const ours: [Card, Card] = [c(14, 1), c(13, 2)];
  const note = describeCombos(countCombos(ours, board), deadRanks(ours, board));
  check('a fully dead rank is described in a real sentence',
    note !== null && note.includes('all four sixes are accounted for'),
    `said: ${note}`);
}

console.log('the nuts is described in words, not arithmetic');
{
  // Nut flush: nothing beats it
  const board = [c(13, 0), c(12, 0), c(7, 0), c(5, 1), c(2, 2)];
  const ours: [Card, Card] = [c(14, 0), c(4, 0)];
  const count = countCombos(ours, board);
  check('nothing beats it', count !== null && count.beatsUs === 0);
  const note = describeCombos(count, deadRanks(ours, board));
  check('and it says so plainly',
    note !== null && !note.includes('Only 0'),
    `said: ${note}`);
}

console.log('repeating a question is cheap');
{
  const board = [c(14, 0), c(9, 1), c(4, 2), c(3, 3), c(2, 0)];
  const ours: [Card, Card] = [c(14, 3), c(13, 1)];
  countCombos(ours, board); // warm

  const t = Date.now();
  for (let i = 0; i < 500; i++) countCombos(ours, board);
  const perCall = (Date.now() - t) / 500;

  /**
   * The advisor recomputes on every DOM mutation, several times a second, on
   * the page's own thread. Uncached this measured 24ms a call — about 120ms
   * of every second spent recomputing an answer that cannot have changed,
   * because the river board and our cards are fixed for the whole decision.
   */
  check('a repeated question is answered from cache', perCall < 1,
    `${perCall.toFixed(2)}ms per repeated call — the cache is not working`);

  // And the cached answer must be the same answer
  const a = countCombos(ours, board)!;
  const b = countCombos([ours[1], ours[0]], board)!;
  check('card order does not create a second cache entry',
    a.beatsUs === b.beatsUs && a.total === b.total);
}

/**
 * The guard, which is the first time these counts change a decision.
 *
 * It has to be narrow. The count treats every combination as equally likely,
 * which is false — he folded some preflop and would not bet others — so it
 * may only override where the weighting cannot matter.
 */
console.log('the river guard vetoes only what it can prove');
{
  setComboGuard(true);

  // Nut flush: nothing beats us, so folding is indefensible however he bets
  const nutBoard = [c(13, 0), c(12, 0), c(7, 0), c(5, 1), c(2, 2)];
  const nuts: [Card, Card] = [c(14, 0), c(4, 0)];
  const vetoFold = comboGuard(nuts, nutBoard, true, 'fold', 0.3);
  check('a fold with the effective nuts is overridden',
    vetoFold !== null && vetoFold.action === 'call',
    `guard said: ${JSON.stringify(vetoFold)}`);

  // The same hand is not touched when we were already calling
  check('a call with the nuts is left alone',
    comboGuard(nuts, nutBoard, true, 'call', 0.3) === null);

  /**
   * The asymmetry that matters.
   *
   * "Almost nothing beats us" is range-independent: the cards to beat us are
   * not in the deck, so no weighting rescues a fold. "Almost everything beats
   * us" is NOT — a polarised betting range is the weak part plus the strong
   * part, so he may be betting precisely the hands we beat. The guard must
   * be far more reluctant in that direction.
   */
  const weakBoard = [c(14, 0), c(13, 1), c(12, 2), c(11, 3), c(10, 0)];
  const weak: [Card, Card] = [c(2, 1), c(3, 2)];
  check('a cheap bluff-catch is not vetoed',
    comboGuard(weak, weakBoard, true, 'call', 0.05) === null,
    'folded a hand getting a huge price purely on the count');
  check('and neither is an expensive one — the mirror rule is off',
    comboGuard(weak, weakBoard, true, 'call', 0.45) === null,
    'the disabled mirror rule fired: it folds the winner against a bluffer');

  // Nothing happens away from the river, or when not facing a bet
  check('no opinion before the river',
    comboGuard(nuts, nutBoard.slice(0, 4), true, 'fold', 0.3) === null);
  check('no opinion when not facing a bet',
    comboGuard(nuts, nutBoard, false, 'fold', 0.3) === null);

  // And the switch really switches it off
  setComboGuard(false);
  check('the guard can be disabled for measurement',
    comboGuard(nuts, nutBoard, true, 'fold', 0.3) === null);
  setComboGuard(true);
}

/**
 * The guard and the note must not say the same thing.
 *
 * The guard fires below 3% of his holdings beating us; the note fires below
 * 12%. So the guard firing GUARANTEES the note fires too, and both used to
 * open "Only N of the 990 hands he can hold beat you" — the same sentence
 * printed twice in one panel. Anywhere the guard can speak, the two lines
 * have to be complementary.
 */
console.log('the guard and the note do not repeat each other');
{
  setComboGuard(true);
  const boards: [Card[], [Card, Card]][] = [
    // Nut flush — nothing beats us
    [[c(13, 0), c(12, 0), c(7, 0), c(5, 1), c(2, 2)], [c(14, 0), c(4, 0)]],
    // Quad eights — a handful of better hands at most
    [[c(8, 0), c(8, 1), c(8, 2), c(3, 3), c(12, 0)], [c(8, 3), c(5, 1)]],
  ];
  let overlaps = 0;
  for (const [board, hole] of boards) {
    const g = comboGuard(hole, board, true, 'fold', 0.35);
    if (!g) continue;
    const note = describeCombos(countCombos(hole, board), deadRanks(hole, board));
    if (!note) continue;
    // No shared opening clause between the two lines
    const first = (s: string) => s.split(/[—;]/)[0].trim();
    if (first(g.reason) === first(note)) overlaps++;
    // And the guard must not quote a raw count at all — that is the note's job
    if (/\d+ of the \d+ hands/.test(g.reason)) overlaps++;
  }
  check('the guard states the conclusion, not the count', overlaps === 0,
    `${overlaps} spots printed the same sentence twice`);
}

/**
 * The firing counters must count.
 *
 * They exist because a rule that never executes is indistinguishable from a
 * rule that does nothing, and today that distinction cost hours: the guard
 * showed a 9.6 bb/100 "effect" while having fired exactly zero times. A
 * counter is the cheapest way to tell those apart — but only if the counter
 * itself is right, which is what this checks.
 */
console.log('the firing counters track what actually fired');
{
  setComboGuard(true);
  resetGuardFirings();
  check('they start at zero',
    guardFirings.neverFold === 0 && guardFirings.mirrorFold === 0);

  // A spot the guard must refuse to fold: the nut flush
  const board = [c(13, 0), c(12, 0), c(7, 0), c(5, 1), c(2, 2)];
  const nuts: [Card, Card] = [c(14, 0), c(4, 0)];
  comboGuard(nuts, board, true, 'fold', 0.3);
  check('a veto increments the counter', guardFirings.neverFold === 1,
    `counter reads ${guardFirings.neverFold} after one veto`);

  // A spot it must stay out of
  comboGuard(nuts, board, true, 'call', 0.3);
  check('a non-veto does not', guardFirings.neverFold === 1,
    'the counter moved on a call it left alone');

  // The disabled mirror rule must never register a firing
  check('the mirror rule never fires while it is off',
    guardFirings.mirrorFold === 0,
    `the disabled rule fired ${guardFirings.mirrorFold} times`);

  resetGuardFirings();
  check('the reset clears them',
    guardFirings.neverFold === 0 && guardFirings.mirrorFold === 0);
}

console.log('a misread table disables the guard rather than crashing it');
{
  setComboGuard(true);
  // The same ace twice — an impossible deck
  const bad = comboGuard(
    [c(14, 0), c(13, 1)],
    [c(14, 0), c(7, 2), c(4, 3), c(3, 0), c(2, 1)],
    true, 'fold', 0.3,
  );
  check('no veto is issued from an impossible deck', bad === null,
    'overrode a decision using a corrupt board');
}

if (failures > 0) {
  console.error(`\n${failures} combo test(s) failed`);
  process.exit(1);
}
console.log('\nall combo tests passed');
