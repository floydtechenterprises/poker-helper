/**
 * Fuzzing the combination counter.
 *
 * Reading this file twice found seven bugs; a third reading found fewer.
 * Fuzzing is what caught the rank-ordering bug in the button range after two
 * readings had missed it, so the same treatment applies here.
 *
 * Every assertion is an invariant that must hold for ANY legal board and
 * holding, not a check of one hand-picked spot.
 */
import {
  countCombos, deadRanks, describeCombos, comboGuard, setComboGuard,
  NEVER_FOLD_BELOW,
} from '../src/engine/combos';
import { evaluate7 } from '../src/engine/hand-evaluator';
import { createDeck } from '../src/engine/cards';
import { Card } from '../src/engine/types';

let failures = 0;
function fail(msg: string): void {
  console.log(`  FAIL ${msg}`);
  failures++;
}

function check2(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `
       ${detail}`}`);
  if (!cond) failures++;
}

/** Deterministic, so a failure can be reproduced exactly. */
let seed = 20260807;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** A random legal deal: two hole cards and five board cards, all distinct. */
function deal(): { hole: [Card, Card]; board: Card[] } {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return { hole: [deck[0], deck[1]], board: deck.slice(2, 7) };
}

console.log('the counts are internally consistent on any deal');
{
  for (let i = 0; i < 3000; i++) {
    const { hole, board } = deal();
    const count = countCombos(hole, board)!;

    if (count.total !== 990) {
      fail(`total was ${count.total}, not C(45,2)=990`); break;
    }
    if (count.beatsUs + count.weBeat + count.ties !== count.total) {
      fail(`buckets do not sum: ${count.beatsUs}+${count.weBeat}+${count.ties}`); break;
    }
    if (count.beatsUs < 0 || count.weBeat < 0 || count.ties < 0) {
      fail('a negative count'); break;
    }
    const f = count.fractionAhead;
    if (!Number.isFinite(f) || f < 0 || f > 1) {
      fail(`fractionAhead is not a rate: ${f}`); break;
    }
    if (Math.abs(f - count.beatsUs / count.total) > 1e-12) {
      fail('fractionAhead disagrees with the counts it came from'); break;
    }
  }
  if (failures === 0) console.log('  PASS 3000 random rivers counted consistently');
}

console.log('the count matches an independent recount');
{
  /**
   * The value of this module is exactness, so it is worth checking against a
   * second implementation rather than against itself. This one is
   * deliberately naive: rebuild the deck, take every pair, evaluate both.
   */
  for (let i = 0; i < 150 && failures === 0; i++) {
    const { hole, board } = deal();
    const count = countCombos(hole, board)!;

    const seen = new Set([...hole, ...board].map(c => c.rank * 4 + c.suit));
    const rest = createDeck().filter(c => !seen.has(c.rank * 4 + c.suit));
    const ourRank = evaluate7([...hole, ...board]);
    let beats = 0;
    for (let a = 0; a < rest.length; a++) {
      for (let b = a + 1; b < rest.length; b++) {
        if (evaluate7([rest[a], rest[b], ...board]) > ourRank) beats++;
      }
    }
    if (beats !== count.beatsUs) {
      fail(`recount disagreed: ${beats} vs ${count.beatsUs}`);
    }
  }
  if (failures === 0) console.log('  PASS 150 deals matched an independent recount');
}

console.log('a stronger hand is never beaten by far more combinations');
{
  /**
   * On a fixed board, the hand that wins at showdown must not be beaten by
   * dramatically more holdings than the one it beats. A count that violates
   * this is not imprecise, it is backwards — and backwards is what would
   * send someone folding the winner.
   *
   * Compared with slack, because the two counts exclude different cards:
   * each removes its own holding from the deck, so they are not counting
   * over an identical 990.
   */
  for (let i = 0; i < 400 && failures === 0; i++) {
    const { board } = deal();
    const seen = new Set(board.map(c => c.rank * 4 + c.suit));
    const rest = createDeck().filter(c => !seen.has(c.rank * 4 + c.suit));

    const pick = (): [Card, Card] => {
      const a = Math.floor(rnd() * rest.length);
      let b = Math.floor(rnd() * rest.length);
      while (b === a) b = Math.floor(rnd() * rest.length);
      return [rest[a], rest[b]];
    };
    const h1 = pick();
    const h2 = pick();
    const overlap = h1.some(x => h2.some(y => x.rank === y.rank && x.suit === y.suit));
    if (overlap) continue;

    const r1 = evaluate7([...h1, ...board]);
    const r2 = evaluate7([...h2, ...board]);
    const c1 = countCombos(h1, board)!;
    const c2 = countCombos(h2, board)!;

    if (r1 > r2 && c1.beatsUs > c2.beatsUs + 30) {
      fail(`the stronger hand was beaten by far more: ${c1.beatsUs} vs ${c2.beatsUs}`);
    }
  }
  if (failures === 0) console.log('  PASS 400 comparisons preserved the ordering');
}

console.log('the description never lies about the count');
{
  for (let i = 0; i < 3000 && failures === 0; i++) {
    const { hole, board } = deal();
    const count = countCombos(hole, board)!;
    const note = describeCombos(count, deadRanks(hole, board));
    if (note === null) continue;

    if (note.includes('Nothing he can hold beats you') && count.beatsUs !== 0) {
      fail(`claimed nothing beats us with ${count.beatsUs} that do`);
    }
    if (note.includes('chops with you') && (count.beatsUs !== 0 || count.weBeat !== 0)) {
      fail('claimed the board plays when it does not');
    }
    const m = note.match(/(\d+) of the (\d+) hands/);
    if (m && (Number(m[1]) !== count.beatsUs || Number(m[2]) !== count.total)) {
      fail(`quoted ${m[1]}/${m[2]} but the counts are ${count.beatsUs}/${count.total}`);
    }
    // No truncated rank names, ever — the bug the plural rule introduced
    if (/only one (ac|nin|fiv|thre|sixe) /.test(note)) {
      fail(`mangled a rank name: "${note}"`);
    }
  }
  if (failures === 0) console.log('  PASS 3000 descriptions matched their counts');
}

console.log('dead ranks are counted correctly on any deal');
{
  for (let i = 0; i < 3000 && failures === 0; i++) {
    const { hole, board } = deal();
    const dead = deadRanks(hole, board);
    for (const d of dead) {
      const actual = [...hole, ...board].filter(c => c.rank === d.rank).length;
      if (actual !== d.seen) fail(`reported ${d.seen} of rank ${d.rank}, actually ${actual}`);
      if (d.seen < 3) fail('flagged a rank seen fewer than three times');
      if (d.seen > 4) fail(`saw ${d.seen} of one rank in a legal deal`);
      if (d.remaining !== 4 - d.seen) fail('remaining does not complete to four');
    }
  }
  if (failures === 0) console.log('  PASS 3000 deals had correct dead-rank arithmetic');
}

console.log('an incomplete board is always refused');
{
  for (let i = 0; i < 500 && failures === 0; i++) {
    const { hole, board } = deal();
    const short = board.slice(0, Math.floor(rnd() * 5));
    if (countCombos(hole, short) !== null) {
      fail(`counted with ${short.length} board cards`);
    }
  }
  if (failures === 0) console.log('  PASS partial boards produced no count');
}

/**
 * The guard is the only part of this module that changes a decision, so it
 * gets the harshest treatment: every legal river, every proposed action,
 * across the whole range of prices.
 */
console.log('the guard never vetoes something it cannot prove');
{
  setComboGuard(true);
  for (let i = 0; i < 4000 && failures === 0; i++) {
    const { hole, board } = deal();
    const price = rnd();
    const proposed = ['fold', 'call', 'check', 'bet', 'raise'][Math.floor(rnd() * 5)];
    const g = comboGuard(hole, board, true, proposed, price);
    if (!g) continue;

    const count = countCombos(hole, board)!;

    // It may only ever produce a legal action
    if (g.action !== 'call' && g.action !== 'fold') {
      fail(`produced action "${g.action}"`);
    }
    // It may only override a fold or a call — never a bet, raise or check
    if (proposed !== 'fold' && proposed !== 'call') {
      fail(`overrode a "${proposed}", which it has no business touching`);
    }
    // A vetoed fold must be genuinely near-unbeatable
    if (g.action === 'call' && count.fractionAhead > NEVER_FOLD_BELOW) {
      fail(`vetoed a fold with ${(count.fractionAhead * 100).toFixed(1)}% beating us`);
    }
    // The reason must never restate the count — that is the note's job
    if (/\d+ of the \d+ hands/.test(g.reason)) {
      fail(`the reason quotes the count, duplicating the note: "${g.reason}"`);
    }
    // And it must never be empty
    if (g.reason.trim().length === 0) fail('an empty reason');
  }
  if (failures === 0) console.log('  PASS 4000 river spots produced only provable vetoes');
}

console.log('the guard is silent everywhere it should be');
{
  let spoke = 0;
  for (let i = 0; i < 2000; i++) {
    const { hole, board } = deal();
    // Not facing a bet
    if (comboGuard(hole, board, false, 'fold', 0.3)) spoke++;
    // Before the river
    if (comboGuard(hole, board.slice(0, 4), true, 'fold', 0.3)) spoke++;
    if (comboGuard(hole, board.slice(0, 3), true, 'fold', 0.3)) spoke++;
  }
  check2('no veto away from a river bet', spoke === 0,
    `${spoke} vetoes issued outside the spots it applies to`);

  // And the switch genuinely disables it
  setComboGuard(false);
  let afterOff = 0;
  for (let i = 0; i < 2000; i++) {
    const { hole, board } = deal();
    if (comboGuard(hole, board, true, 'fold', 0.3)) afterOff++;
  }
  check2('the switch disables every veto', afterOff === 0,
    `${afterOff} vetoes issued while switched off`);
  setComboGuard(true);
}

if (failures > 0) {
  console.error(`\n${failures} combo fuzz failure(s)`);
  process.exit(1);
}
console.log('\nall combo fuzz tests passed');
