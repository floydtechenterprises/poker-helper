import { Card, Rank } from './types';

// Hand rank encoding: (category << 20) | (primary << 16) | (secondary << 12) | kickers
// Category: 0=high card, 1=pair, 2=two pair, 3=trips, 4=straight, 5=flush, 6=full house, 7=quads, 8=straight flush
// Higher number = better hand

export const HAND_CATEGORIES = [
  'high-card', 'pair', 'two-pair', 'three-of-a-kind',
  'straight', 'flush', 'full-house', 'four-of-a-kind', 'straight-flush',
] as const;

/**
 * The categories the evaluator can actually return.
 *
 * Derived from the array `handCategoryName` indexes into, so it cannot drift
 * from the implementation the way the hand-written version did. Note there
 * is deliberately no 'royal-flush': it is a straight flush with a high card
 * of 14, and giving it a category would break the rank encoding.
 */
export type HandCategory = typeof HAND_CATEGORIES[number];

export function handCategoryName(rank: number): string {
  const cat = rank >> 20;
  return HAND_CATEGORIES[cat] ?? 'unknown';
}

/**
 * Score exactly five cards.
 *
 * The length check is not defensive padding — it is the difference between
 * an error and a wrong answer. `suits.every(...)` is vacuously true on an
 * empty array and trivially true on a short suited one, so a four-card
 * holding came back as a FLUSH, and an empty one did too. Nothing threw and
 * nothing logged; the caller just received a hand that does not exist and
 * carried on.
 */
export function evaluate5(cards: Card[]): number {
  if (cards.length !== 5) {
    throw new Error(`evaluate5 needs exactly 5 cards, got ${cards.length}`);
  }
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  let rankBits = 0;
  for (const r of ranks) rankBits |= (1 << r);
  // Check wheel: A-2-3-4-5
  const wheelBits = (1 << 14) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
  const isWheel = (rankBits & wheelBits) === wheelBits && ranks.length === 5;

  let isStraight = false;
  let straightHigh: Rank = ranks[0];
  if (isWheel && new Set(ranks).size === 5) {
    isStraight = true;
    straightHigh = 5 as Rank; // wheel tops at 5
  } else {
    for (let top = 14; top >= 6; top--) {
      const mask = 0b11111 << (top - 4);
      if ((rankBits & mask) === mask) {
        const uniqueInRange = new Set(ranks.filter(r => r >= top - 4 && r <= top));
        if (uniqueInRange.size === 5) {
          isStraight = true;
          straightHigh = top as Rank;
          break;
        }
      }
    }
  }

  if (isFlush && isStraight) {
    return (8 << 20) | (straightHigh << 16);
  }

  // Count rank frequencies
  const freq = new Map<Rank, number>();
  for (const r of ranks) freq.set(r, (freq.get(r) || 0) + 1);

  const groups = [...freq.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // by count desc
    return b[0] - a[0]; // by rank desc
  });

  const counts = groups.map(g => g[1]);
  const groupRanks = groups.map(g => g[0]);

  // Four of a kind
  if (counts[0] === 4) {
    return (7 << 20) | (groupRanks[0] << 16) | (groupRanks[1] << 12);
  }

  // Full house
  if (counts[0] === 3 && counts[1] === 2) {
    return (6 << 20) | (groupRanks[0] << 16) | (groupRanks[1] << 12);
  }

  // Flush
  if (isFlush) {
    return (5 << 20) | (ranks[0] << 16) | (ranks[1] << 12) | (ranks[2] << 8) | (ranks[3] << 4) | ranks[4];
  }

  // Straight
  if (isStraight) {
    return (4 << 20) | (straightHigh << 16);
  }

  // Three of a kind
  if (counts[0] === 3) {
    return (3 << 20) | (groupRanks[0] << 16) | (groupRanks[1] << 12) | (groupRanks[2] << 8);
  }

  // Two pair
  if (counts[0] === 2 && counts[1] === 2) {
    // `groups` is already sorted by count then by rank descending, so
    // groupRanks[0] is the higher pair. The Math.max/min that used to be
    // here implied that ordering was not guaranteed — every other branch
    // relies on it, so stating it once and trusting it is the honest form.
    return (2 << 20) | (groupRanks[0] << 16) | (groupRanks[1] << 12) | (groupRanks[2] << 8);
  }

  // One pair
  if (counts[0] === 2) {
    return (1 << 20) | (groupRanks[0] << 16) | (groupRanks[1] << 12) | (groupRanks[2] << 8) | (groupRanks[3] << 4);
  }

  // High card
  return (0 << 20) | (ranks[0] << 16) | (ranks[1] << 12) | (ranks[2] << 8) | (ranks[3] << 4) | ranks[4];
}

/**
 * Best five-card hand out of exactly seven.
 *
 * Given SIX cards the index arithmetic quietly produced four-card subsets —
 * the loops still ran to 7, so removing two in-range indices left four — and
 * `evaluate5` scored four suited cards as a flush. A six-card input (two hole
 * plus a turn board) therefore reported flushes that were not there.
 */
export function evaluate7(cards: Card[]): number {
  if (cards.length !== 7) {
    throw new Error(`evaluate7 needs exactly 7 cards, got ${cards.length}`);
  }
  let best = 0;
  // Check all 21 combinations of 5 from 7
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const five = cards.filter((_, idx) => idx !== i && idx !== j);
      const rank = evaluate5(five);
      if (rank > best) best = rank;
    }
  }
  return best;
}

/** Best five-card hand out of exactly six — the turn, with hole cards. */
export function evaluate6(cards: Card[]): number {
  if (cards.length !== 6) {
    throw new Error(`evaluate6 needs exactly 6 cards, got ${cards.length}`);
  }
  let best = 0;
  for (let i = 0; i < 6; i++) {
    const five = cards.filter((_, idx) => idx !== i);
    const rank = evaluate5(five);
    if (rank > best) best = rank;
  }
  return best;
}

/**
 * `evaluateHand(hole, community)` used to live here and has been removed.
 *
 * It had no callers, which is the only reason it never cost anything: it
 * routed six cards — two hole plus a TURN board, an ordinary everyday case —
 * to `evaluate7`, which then scored four suited cards as a flush. The
 * correct function for six cards, `evaluate6`, was sitting right above it
 * and was never called.
 *
 * Callers should pick the evaluator for the length they actually have:
 * `evaluate5`, `evaluate6`, `evaluate7`, or `evaluate7Fast` for hot paths.
 * Each now refuses the wrong count rather than guessing.
 */
