import { Card } from './types';

/**
 * Allocation-free 7-card hand evaluator.
 *
 * The original evaluate7 enumerates all 21 five-card subsets and allocates
 * a fresh array for each, then evaluate5 allocates several more (map, sort,
 * Set, Map) per call. Profiling put it at ~47µs, which made simulation the
 * bottleneck for everything.
 *
 * This computes the answer directly from rank/suit counts with no
 * allocation and no combinatorics. The output encoding is byte-for-byte
 * identical to evaluate5/evaluate7, so ranks stay comparable across the
 * whole codebase — there is a differential test asserting exact equality
 * over random hands.
 */

// Scratch buffers reused across calls. Safe because evaluation is
// synchronous and single-threaded within a call.
const rankCount = new Int8Array(15);
const suitCount = new Int8Array(4);
const suitRankBits = new Int32Array(4);

/** Highest card of a 5-straight in a rank bitmask, or 0 if none. */
function straightHigh(bits: number): number {
  // Ace plays low for the wheel: mirror bit 14 down to bit 1
  let s = bits;
  if (s & (1 << 14)) s |= 1 << 1;
  for (let hi = 14; hi >= 5; hi--) {
    const mask = 0b11111 << (hi - 4);
    if ((s & mask) === mask) return hi;
  }
  return 0;
}

/** Top n set bits of a rank mask, highest first, packed 4 bits each. */
function topRanks(bits: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 14; r >= 2 && out.length < n; r--) {
    if (bits & (1 << r)) out.push(r);
  }
  return out;
}

export function evaluate7Fast(cards: Card[]): number {
  /**
   * Exactly seven. Two separate reasons, and only one of them is obvious.
   *
   * Too FEW cards: `topRanks` returns a short list, the missing entries
   * coerce to 0 through the bitwise OR, and the result is a wrong score
   * rather than an error — five cards scored as a hand with zero kickers.
   *
   * Too MANY cards: the flush family is checked BEFORE quads and full
   * houses, which is only valid at seven. With five or more of one suit
   * among seven cards, a quad or a full house is arithmetically impossible —
   * the at-most-two off-suit cards cannot supply the extra pair. At eight or
   * more that stops holding, and a full house would be reported as a flush.
   * The ordering is a performance choice that quietly depends on the count.
   */
  if (cards.length !== 7) {
    throw new Error(`evaluate7Fast needs exactly 7 cards, got ${cards.length}`);
  }
  rankCount.fill(0);
  suitCount.fill(0);
  suitRankBits.fill(0);

  let allRankBits = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    rankCount[c.rank]++;
    suitCount[c.suit]++;
    suitRankBits[c.suit] |= 1 << c.rank;
    allRankBits |= 1 << c.rank;
  }

  // ---- Flush family ----
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) { flushSuit = s; break; }
  }

  if (flushSuit >= 0) {
    const fb = suitRankBits[flushSuit];
    const sfHigh = straightHigh(fb);
    if (sfHigh) return (8 << 20) | (sfHigh << 16);

    const t = topRanks(fb, 5);
    return (5 << 20) | (t[0] << 16) | (t[1] << 12) | (t[2] << 8) | (t[3] << 4) | t[4];
  }

  // ---- Count-based families ----
  // Walk ranks high to low collecting quads / trips / pairs
  let quad = 0, trip = 0, trip2 = 0, pair = 0, pair2 = 0;
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n === 4) { if (!quad) quad = r; }
    else if (n === 3) { if (!trip) trip = r; else if (!trip2) trip2 = r; }
    else if (n === 2) { if (!pair) pair = r; else if (!pair2) pair2 = r; }
  }

  if (quad) {
    // Best kicker is the highest remaining card
    let kicker = 0;
    for (let r = 14; r >= 2; r--) {
      if (r !== quad && rankCount[r] > 0) { kicker = r; break; }
    }
    return (7 << 20) | (quad << 16) | (kicker << 12);
  }

  if (trip && (pair || trip2)) {
    // Two trips: the lower one plays as the pair
    const pairRank = trip2 > pair ? trip2 : pair;
    return (6 << 20) | (trip << 16) | (pairRank << 12);
  }

  const sHigh = straightHigh(allRankBits);
  if (sHigh) return (4 << 20) | (sHigh << 16);

  if (trip) {
    const k: number[] = [];
    for (let r = 14; r >= 2 && k.length < 2; r--) {
      if (r !== trip && rankCount[r] > 0) k.push(r);
    }
    return (3 << 20) | (trip << 16) | (k[0] << 12) | (k[1] << 8);
  }

  if (pair && pair2) {
    let kicker = 0;
    for (let r = 14; r >= 2; r--) {
      if (r !== pair && r !== pair2 && rankCount[r] > 0) { kicker = r; break; }
    }
    return (2 << 20) | (pair << 16) | (pair2 << 12) | (kicker << 8);
  }

  if (pair) {
    const k: number[] = [];
    for (let r = 14; r >= 2 && k.length < 3; r--) {
      if (r !== pair && rankCount[r] > 0) k.push(r);
    }
    return (1 << 20) | (pair << 16) | (k[0] << 12) | (k[1] << 8) | (k[2] << 4);
  }

  const t = topRanks(allRankBits, 5);
  return (0 << 20) | (t[0] << 16) | (t[1] << 12) | (t[2] << 8) | (t[3] << 4) | t[4];
}
