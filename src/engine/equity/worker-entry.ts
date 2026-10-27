// Equity calculator for the Web Worker. esbuild bundles this entry point,
// so the shared fast evaluator is imported rather than duplicated.
import { evaluate7Fast } from '../fast-evaluator';
import { evaluate5 } from '../hand-evaluator';
import {
  RangeSpec, toRangeSpec, effectiveMinCategory, VALUE_FILTER_RETRIES, RANGE_FILTER_RETRIES,
} from './range-spec';
// One shared implementation — this file used to carry its own copy under a
// 'keep the two in sync' comment that nothing enforced.
import { handPercentile } from './hand-percentile';

type Suit = 0 | 1 | 2 | 3;
type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
interface Card { rank: Rank; suit: Suit; }

function evaluate7(cards: Card[]): number {
  return evaluate7Fast(cards as any);
}

function cardIndex(c: Card): number { return (c.rank - 2) * 4 + c.suit; }

function createDeckExcluding(exclude: Card[]): Card[] {
  const ex = new Set(exclude.map(cardIndex));
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) {
      const c: Card = { rank: r as Rank, suit: s as Suit };
      if (!ex.has(cardIndex(c))) deck.push(c);
    }
  }
  return deck;
}

interface WorkerMessage {
  /** Echoed back so the pool can discard replies to abandoned requests. */
  id?: number;
  holeCards: [Card, Card];
  communityCards: Card[];
  numOpponents: number;
  iterations: number;
  /** A scalar (top X% of starting hands) or the full board-aware spec. */
  opponentRange?: number | RangeSpec;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { holeCards, communityCards, numOpponents, iterations } = e.data;
  const id = e.data.id;
  // The worker's result OVERRIDES the main thread's own calculation, so if
  // it ignored the value filter the whole board-aware range would be dead in
  // the real extension while looking perfect in tests.
  const spec = toRangeSpec(e.data.opponentRange ?? 1);
  const opponentRange = spec.percentile;
  const useRange = opponentRange < 0.999;
  const useValue = spec.valueWeight > 0;
  // Only the player who actually bet is telling us anything
  const valueOpponents = Math.max(0, Math.min(numOpponents, spec.valueOpponents ?? 1));
  const deck = createDeckExcluding([...holeCards, ...communityCards]);
  const communityNeeded = 5 - communityCards.length;

  /**
   * Refuse bad input rather than scoring it.
   *
   * The board is always dealt out to exactly five, so every evaluation below
   * is a seven-card one. A malformed board of six or more would hand
   * `evaluate7` eight cards; before the evaluators grew length checks that
   * was silently scored as five and returned a plausible but wrong equity.
   *
   * `numOpponents` matters as much as the board, and used to be unchecked.
   *
   * With zero opponents the inner loop never runs, so `heroBest` stays true,
   * `tied` stays false, and every iteration counts as a win — the worker
   * reported 100% equity, confidently, for a hand with nobody to beat. The
   * main thread throws on the same input; the worker returned 1.0 and its
   * result OVERRIDES the main thread's. That asymmetry is precisely how a
   * disagreement between the two paths stays invisible.
   *
   * `iterations` is checked for the same reason: a NaN would run zero passes
   * and report samples the pool then divides by.
   */
  // A card cannot be in two places. `createDeckExcluding` uses a Set, so a
  // duplicate collapses and leaves a live card in the deck that is already
  // in play — the equity then comes back subtly wrong with nothing to show
  // for it. Kept identical to the main thread's check on purpose.
  const known = [...holeCards, ...communityCards];
  const distinct = new Set(known.map(cardIndex)).size;

  const badInput = communityNeeded < 0
    || holeCards.length !== 2
    || distinct !== known.length
    || !Number.isFinite(numOpponents) || numOpponents < 1
    || !Number.isFinite(iterations) || iterations < 1
    // Not enough cards left to deal everyone in
    || communityNeeded + numOpponents * 2 > deck.length;

  if (badInput) {
    (self as any).postMessage({
      id,
      wins: 0, ties: 0, losses: 0, samples: 0,
      error: `bad input: ${holeCards.length} hole cards, ${communityCards.length} board cards, `
        + `${numOpponents} opponents, ${iterations} iterations`,
    });
    return;
  }

  let wins = 0, ties = 0, losses = 0;

  for (let i = 0; i < iterations; i++) {
    // Partial Fisher-Yates
    const needed = communityNeeded + numOpponents * 2;
    for (let k = deck.length - 1; k > deck.length - 1 - needed && k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      const tmp = deck[k]; deck[k] = deck[j]; deck[j] = tmp;
    }

    let cursor = deck.length;

    // Opponents' hands first, then the runout from what is left: the same
    // order as monte-carlo.ts, and for the same reason (N3)
    for (let o = 0; o < numOpponents; o++) {
      const p1 = --cursor;
      const p2 = --cursor;

      // Range filter: swap rejected junk hands with undealt cards IN PLACE
      // so the deck stays a valid permutation
      if (useRange && p2 > 1) {
        let tries = 0;
        while (handPercentile(deck[p1], deck[p2]) > opponentRange && tries < RANGE_FILTER_RETRIES) {
          const q1 = Math.floor(Math.random() * p2);
          const q2 = Math.floor(Math.random() * p2);
          if (q1 !== q2) {
            const t1 = deck[p1]; deck[p1] = deck[q1]; deck[q1] = t1;
            const t2 = deck[p2]; deck[p2] = deck[q2]; deck[q2] = t2;
          }
          tries++;
        }
      }
    }

    const board = [...communityCards];
    for (let c = 0; c < communityNeeded; c++) board.push(deck[--cursor]);
    const undealt = cursor;

    const heroCards = [...holeCards, ...board];
    const heroRank = evaluate7(heroCards);
    // What the board is worth on its own, so "a real hand" can be judged
    // relative to it rather than as an absolute category
    const boardCategory = useValue ? (evaluate5(board as any) >> 20) : 0;

    let heroBest = true;
    let tied = false;
    for (let o = 0; o < numOpponents; o++) {
      const p1 = deck.length - 1 - 2 * o;
      const p2 = p1 - 1;

      // Same value filter as the main thread: on this share of samples the
      // opponent must actually CONNECT with the board, not merely hold a
      // good starting hand. Kept identical to monte-carlo.ts on purpose —
      // the two disagreeing is invisible and decides every hand.
      if (useValue && o < valueOpponents && undealt > 1 && Math.random() < spec.valueWeight) {
        // Relative to the board — see effectiveMinCategory. On a paired or
        // tripled board an absolute category is free.
        const need = effectiveMinCategory(spec.minCategory, boardCategory);
        // 16 retries was not enough. On a dry board only ~10% of hands
        // make two pair, so the loop gave up 18% of the time and kept a
        // hand that does NOT qualify — a requested weight of 0.81 was
        // really delivering 0.67, and worst exactly where narrowing matters
        // most. The loop exits on the first success, so raising the cap
        // costs almost nothing on average and only trims the tail.
        let vt = 0;
        while (vt < VALUE_FILTER_RETRIES) {
          const test = [deck[p1], deck[p2], ...board];
          if ((evaluate7(test) >> 20) >= need) break;
          // Only undealt cards: the board is already out
          const q1 = Math.floor(Math.random() * undealt);
          const q2 = Math.floor(Math.random() * undealt);
          if (q1 !== q2) {
            const t1 = deck[p1]; deck[p1] = deck[q1]; deck[q1] = t1;
            const t2 = deck[p2]; deck[p2] = deck[q2]; deck[q2] = t2;
          }
          vt++;
        }
      }

      const oppCards = [deck[p1], deck[p2], ...board];
      const oppRank = evaluate7(oppCards);
      if (oppRank > heroRank) { heroBest = false; break; }
      else if (oppRank === heroRank) tied = true;
    }

    if (heroBest && !tied) wins++;
    else if (heroBest && tied) ties++;
    else losses++;
  }

  (self as any).postMessage({ id, wins, ties, losses, samples: iterations });
};
