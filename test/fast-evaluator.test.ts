/**
 * The fast evaluator replaces the combinatorial one everywhere, so it must
 * produce byte-identical ranks — not merely the same winner. Anything less
 * silently changes every equity number in the app.
 */
import { evaluate7 } from '../src/engine/hand-evaluator';
import { evaluate7Fast } from '../src/engine/fast-evaluator';
import { createDeck } from '../src/engine/cards';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (rank: number, suit: number): Card =>
  ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

function describe(cards: Card[]): string {
  const R: Record<number, string> = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
  const S = ['c', 'd', 'h', 's'];
  return cards.map(x => `${R[x.rank] || x.rank}${S[x.suit]}`).join(' ');
}

console.log('known hands — category must be right');
const cat = (cards: Card[]) => evaluate7Fast(cards) >> 20;

expect('straight flush', cat([
  c(9, 0), c(8, 0), c(7, 0), c(6, 0), c(5, 0), c(2, 1), c(3, 2)]), 8);
expect('steel wheel (A-5 straight flush)', cat([
  c(14, 0), c(2, 0), c(3, 0), c(4, 0), c(5, 0), c(9, 1), c(13, 2)]), 8);
expect('quads', cat([
  c(9, 0), c(9, 1), c(9, 2), c(9, 3), c(5, 0), c(2, 1), c(3, 2)]), 7);
expect('full house', cat([
  c(9, 0), c(9, 1), c(9, 2), c(5, 3), c(5, 0), c(2, 1), c(3, 2)]), 6);
expect('two trips makes a boat', cat([
  c(9, 0), c(9, 1), c(9, 2), c(5, 3), c(5, 0), c(5, 1), c(3, 2)]), 6);
expect('flush', cat([
  c(14, 0), c(9, 0), c(7, 0), c(4, 0), c(2, 0), c(5, 1), c(3, 2)]), 5);
expect('straight', cat([
  c(9, 0), c(8, 1), c(7, 2), c(6, 3), c(5, 0), c(2, 1), c(13, 2)]), 4);
expect('wheel straight', cat([
  c(14, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0), c(9, 1), c(13, 2)]), 4);
expect('trips', cat([
  c(9, 0), c(9, 1), c(9, 2), c(5, 3), c(4, 0), c(2, 1), c(13, 2)]), 3);
expect('two pair', cat([
  c(9, 0), c(9, 1), c(5, 2), c(5, 3), c(4, 0), c(2, 1), c(13, 2)]), 2);
expect('one pair', cat([
  c(9, 0), c(9, 1), c(5, 2), c(4, 3), c(3, 0), c(2, 1), c(13, 2)]), 1);
expect('high card', cat([
  c(9, 0), c(7, 1), c(5, 2), c(4, 3), c(3, 0), c(2, 1), c(13, 2)]), 0);

// A flush must not be mistaken for a straight flush when the suited cards
// don't run consecutively
expect('flush with a non-suited straight stays a flush', cat([
  c(9, 0), c(8, 1), c(7, 0), c(6, 2), c(5, 0), c(3, 0), c(2, 0)]), 5);

console.log('differential vs the original evaluator (exact equality)');
{
  const deck = createDeck();
  let mismatches = 0;
  let firstBad = '';
  const N = 60_000;

  for (let i = 0; i < N; i++) {
    // Fisher-Yates the first 7 slots
    for (let k = 0; k < 7; k++) {
      const j = k + Math.floor(Math.random() * (deck.length - k));
      const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
    }
    const hand = deck.slice(0, 7);
    const a = evaluate7(hand);
    const b = evaluate7Fast(hand);
    if (a !== b) {
      mismatches++;
      if (!firstBad) firstBad = `${describe(hand)}  old=${a.toString(16)} new=${b.toString(16)}`;
    }
  }
  expect(`${N} random 7-card hands match exactly`, mismatches, 0);
  if (mismatches) console.error(`    first mismatch: ${firstBad}`);
}

console.log('differential on paired/suited boards (where the edge cases live)');
{
  // Bias the deck toward collisions: fewer distinct ranks and suits
  let mismatches = 0;
  const ranks = [14, 13, 9, 9, 5, 5, 5, 2];
  const suits = [0, 0, 0, 1, 1, 2, 3];
  for (let i = 0; i < 20_000; i++) {
    const hand: Card[] = [];
    for (let k = 0; k < 7; k++) {
      hand.push(c(
        ranks[Math.floor(Math.random() * ranks.length)],
        suits[Math.floor(Math.random() * suits.length)],
      ));
    }
    // Skip impossible hands (duplicate exact cards)
    const seen = new Set(hand.map(x => x.rank * 4 + x.suit));
    if (seen.size !== 7) continue;

    if (evaluate7(hand) !== evaluate7Fast(hand)) {
      mismatches++;
      if (mismatches === 1) console.error(`    mismatch on: ${describe(hand)}`);
    }
  }
  expect('collision-heavy hands match exactly', mismatches, 0);
}

process.exit(failures > 0 ? 1 : 0);
