import { Card, Rank, HandStrength, RelativeStrength } from '../types';
import { evaluate6, evaluate5, handCategoryName } from '../hand-evaluator';
import { evaluate7Fast as evaluate7 } from '../fast-evaluator';
import { cardIndex, createDeck } from '../cards';

export function classifyHandStrength(
  holeCards: [Card, Card],
  communityCards: Card[],
  // Outs are expensive to compute (brute force over every unseen card) and
  // the caller usually already has them. Recomputing was the single
  // largest cost in the whole engine.
  precomputedOuts?: number,
): HandStrength {
  const all = [...holeCards, ...communityCards];
  const handRank = all.length >= 7
    ? evaluate7(all)
    : all.length === 6
      ? evaluate6(all)
      : evaluate5(all.slice(0, 5));
  const category = handRank >> 20;

  const madeHand = category;

  const drawStrength = countDrawStrength(holeCards, communityCards, precomputedOuts);

  const relative = classifyRelative(holeCards, communityCards, category, handRank);

  const description = describeHand(holeCards, communityCards, category, handRank);

  return {
    category: description,
    madeHand,
    drawStrength,
    relative,
  };
}

function classifyRelative(
  holeCards: [Card, Card],
  communityCards: Card[],
  category: number,
  handRank: number,
): RelativeStrength {
  if (category >= 6) return 'nuts';       // full house+
  if (category === 5) return 'strong';    // flush
  if (category === 4) {
    /**
     * A straight is only "medium" when the BOARD already makes it.
     *
     * This asked `usesHoleCards`, which tests whether a hole card's rank
     * appears on the board — and got the common case exactly backwards. On
     * 9-T-J holding Q-8 you hold the straight itself, using both your cards;
     * neither Q nor 8 is on the board, so it returned false and the hand was
     * classified 'medium'. The strongest possible way to hold a straight
     * scored as one of the weakest.
     *
     * The real question is whether our cards changed anything: if the five
     * board cards already make this same straight, everyone in the pot has
     * it and it is a chop waiting to happen. Otherwise we made it.
     */
    return boardMakesSameStraight(communityCards, handRank) ? 'medium' : 'strong';
  }

  if (category === 3) {
    // Trips/set — but if the trips are entirely on the board, we have nothing
    const tripRank = ((handRank >> 16) & 0xF);
    const holeR = holeCards.map(c => c.rank);
    const boardTripCount = communityCards.filter(c => c.rank === tripRank).length;
    if (boardTripCount >= 3 && !holeR.includes(tripRank as Rank)) {
      return Math.max(holeR[0], holeR[1]) >= 13 ? 'weak' : 'air';
    }
    return 'strong';
  }

  if (category === 1) {
    // Pair — top pair? overpair? middle pair?
    const boardRanks = communityCards.map(c => c.rank).sort((a, b) => b - a);
    const holeRanks = holeCards.map(c => c.rank);
    const topBoardRank = boardRanks[0];
    const pairRank = ((handRank >> 16) & 0xF) as Rank;

    // The pair is entirely on the board — we have nothing, we're playing the board
    const isPocketPair = holeRanks[0] === holeRanks[1];
    if (!isPocketPair && !holeRanks.includes(pairRank)) {
      const holeMax = Math.max(holeRanks[0], holeRanks[1]);
      if (holeMax >= 14) return 'weak'; // ace high has some showdown value
      return 'air';
    }

    // Overpair
    if (isPocketPair && holeRanks[0] > topBoardRank) return 'strong';
    // Top pair
    if (holeRanks.includes(topBoardRank)) {
      const kicker = holeRanks.find(r => r !== topBoardRank) || holeRanks[0];
      if (kicker >= 12) return 'strong';  // top pair good kicker
      if (kicker >= 9) return 'medium';
      return 'weak';
    }
    // Middle/bottom pair
    return 'weak';
  }

  if (category === 2) {
    // Two pair — if both pairs are on the board we have nothing
    const boardFreq = new Map<number, number>();
    for (const c of communityCards) boardFreq.set(c.rank, (boardFreq.get(c.rank) || 0) + 1);
    const boardPairs = [...boardFreq.values()].filter(n => n >= 2).length;
    const holeRanks = holeCards.map(c => c.rank);
    const holeConnects = holeRanks.some(r => communityCards.some(c => c.rank === r))
      || holeRanks[0] === holeRanks[1];
    if (boardPairs >= 2 && !holeConnects) {
      return Math.max(holeRanks[0], holeRanks[1]) >= 14 ? 'weak' : 'air';
    }
    return 'medium';
  }

  // High card.
  //
  // What matters is the hand we actually hold, not the cards in our hand.
  // With A-Q-6 on board, K9 makes A-K-Q-9-6 — ace high with the second-best
  // kicker, which beats every busted draw and is a genuine bluff-catcher.
  // Judging by our own top card alone called that "air" and threw it away.
  const bestHigh = (handRank >> 16) & 0xF;
  const bestSecond = (handRank >> 12) & 0xF;
  const holeRanks = holeCards.map(c => c.rank);
  const boardSorted = [...communityCards.map(c => c.rank)].sort((a, b) => b - a);

  // Do our cards appear in the top two of the made hand at all?
  const contributes = holeRanks.includes(bestHigh as Rank)
    || holeRanks.includes(bestSecond as Rank);

  // Playing the board entirely: our cards change nothing, so anyone who
  // also missed splits with us and anything else beats us
  const playingBoard = communityCards.length >= 5
    && boardSorted.slice(0, 5).every((r, i) => {
      const ours = [bestHigh, bestSecond];
      return i > 1 || ours[i] === r;
    })
    && !contributes;
  if (playingBoard) return 'air';

  // Ace high, or our card riding as a strong kicker behind the board's ace
  if (bestHigh >= 14 && (contributes || holeRanks.some(r => r >= 12))) return 'weak';
  if (bestHigh >= 13 && contributes) return 'weak';
  return 'air';
}

/**
 * Does the board alone already make the straight we hold?
 *
 * With fewer than five community cards it cannot — a straight needs five
 * cards, so any straight we have must be using our hand. On a five-card
 * board we score the board by itself and compare: same category, same high
 * card, and our hole cards added nothing anyone else does not have.
 */
function boardMakesSameStraight(community: Card[], handRank: number): boolean {
  if (community.length < 5) return false;
  const boardRank = evaluate5(community.slice(0, 5));
  // Category 4 is a straight; bits 16-19 hold its high card
  return (boardRank >> 20) === 4 && ((boardRank >> 16) & 0xF) === ((handRank >> 16) & 0xF);
}

function describeHand(
  holeCards: [Card, Card],
  communityCards: Card[],
  category: number,
  handRank: number,
): string {
  const rankName = (r: Rank) => {
    const names: Record<number, string> = {
      14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten',
      9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five',
      4: 'Four', 3: 'Three', 2: 'Two',
    };
    return names[r] || String(r);
  };

  const boardRanks = communityCards.map(c => c.rank).sort((a, b) => b - a);
  const holeRanks = holeCards.map(c => c.rank).sort((a, b) => b - a);

  switch (category) {
    case 8: return 'Straight flush!';
    case 7: return `Four of a kind — ${rankName(((handRank >> 16) & 0xF) as Rank)}s`;
    case 6: return 'Full house';
    case 5: return 'Flush';
    case 4: return 'Straight';
    case 3: {
      const tripRank = ((handRank >> 16) & 0xF) as Rank;
      if (holeRanks[0] === holeRanks[1]) return `Set of ${rankName(tripRank)}s`;
      return `Three of a kind — ${rankName(tripRank)}s`;
    }
    case 2: return 'Two pair';
    case 1: {
      if (holeRanks[0] === holeRanks[1]) {
        if (holeRanks[0] > boardRanks[0]) return `Overpair — ${rankName(holeRanks[0])}s`;
        return `Pocket ${rankName(holeRanks[0])}s`;
      }
      const pairedRank = holeRanks.find(r => boardRanks.includes(r));
      if (pairedRank === boardRanks[0]) {
        const kicker = holeRanks.find(r => r !== pairedRank) || pairedRank;
        return `Top pair, ${rankName(kicker)} kicker`;
      }
      if (pairedRank) {
        const kicker = holeRanks.find(r => r !== pairedRank);
        const kickerStr = kicker && kicker >= 11 ? `, ${rankName(kicker as Rank)} kicker` : '';
        const isSecond = boardRanks.length > 1 && pairedRank === boardRanks[1];
        return `Pair of ${rankName(pairedRank)}s${kickerStr} (${isSecond ? 'middle pair' : 'weak pair'})`;
      }
      // Pair is on the board, not in our hand
      return `Board pair — you only have ${rankName(holeRanks[0])} high`;
    }
    case 0: {
      // Name the hand we actually hold. Saying "King high" when the board's
      // ace plays understates a real bluff-catcher into sounding worthless.
      const high = ((handRank >> 16) & 0xF) as Rank;
      const second = ((handRank >> 12) & 0xF) as Rank;
      const ourHigh = holeRanks.includes(high);
      const ourSecond = holeRanks.includes(second);

      if (!ourHigh && !ourSecond) {
        return `${rankName(high)} high — playing the board`;
      }
      if (!ourHigh && ourSecond) {
        return `${rankName(high)} high (board), ${rankName(second)} kicker`;
      }
      return `${rankName(high)} high, ${rankName(second)} kicker`;
    }
    default: return handCategoryName(handRank);
  }
}

/**
 * Exact outs count: try every unseen card and see which ones actually
 * upgrade us to a straight or better. No window heuristics, no
 * double-counting — a card that completes both a flush and a straight is
 * one out, counted once.
 */
export function countOuts(holeCards: [Card, Card], communityCards: Card[]): { outs: number; draws: string[] } {
  if (communityCards.length < 3 || communityCards.length >= 5) return { outs: 0, draws: [] };

  const known = [...holeCards, ...communityCards];
  const seen = new Set(known.map(cardIndex));

  const currentRank = known.length === 6 ? evaluate6(known) : evaluate5(known);
  const currentCat = currentRank >> 20;

  // Already have a straight or better — "draws" no longer drive the decision
  if (currentCat >= 4) return { outs: 0, draws: [] };

  let flushOuts = 0;
  let straightOuts = 0;
  let comboOuts = 0;
  let totalOuts = 0;

  for (const c of createDeck()) {
    if (seen.has(cardIndex(c))) continue;

    const withCard = [...known, c];
    const newRank = withCard.length === 7 ? evaluate7(withCard) : evaluate6(withCard);
    const newCat = newRank >> 20;

    /**
     * A card that improves the BOARD is not an out.
     *
     * On 3h-4h-5h-6h holding 3s-3d, every remaining heart puts five hearts on
     * the board and every 2 or 7 completes a straight on the board. Those
     * were all counted as our outs — 25 of them — and reported to the user as
     * "Flush draw (9 outs)" while we held no heart at all. They improve
     * everyone equally: anyone with a single heart beats the board flush, and
     * the rest chop.
     *
     * So the card only counts if our seven beats what the five board cards
     * make on their own. Below five board cards this cannot arise — four
     * cards cannot complete anything by themselves — so the comparison is
     * skipped rather than guessed at.
     */
    const boardAfter = [...communityCards, c];
    if (boardAfter.length === 5 && evaluate5(boardAfter) >= newRank) continue;

    if (newCat >= 4 && newCat > currentCat) {
      totalOuts++;
      const madeFlush = newCat === 5 || newCat === 8;
      const madeStraight = newCat === 4 || newCat === 8;
      if (madeFlush && madeStraight) comboOuts++;
      else if (madeFlush) flushOuts++;
      else if (madeStraight) straightOuts++;
    }
  }

  const draws: string[] = [];
  const flushTotal = flushOuts + comboOuts;
  const straightTotal = straightOuts + comboOuts;

  if (flushTotal >= 7) draws.push(`Flush draw (${flushTotal} outs)`);
  if (straightTotal >= 7) draws.push(`Open-ended straight draw (${straightTotal} outs)`);
  else if (straightTotal >= 3) draws.push(`Gutshot straight draw (${straightTotal} outs)`);
  if (flushTotal >= 7 && straightTotal >= 3) draws.push('Combo draw!');

  return { outs: totalOuts, draws };
}

export function countDrawStrength(
  holeCards: [Card, Card], communityCards: Card[], precomputedOuts?: number,
): number {
  const outs = precomputedOuts ?? countOuts(holeCards, communityCards).outs;
  if (outs >= 12) return 5; // monster draw
  if (outs >= 9) return 4;  // flush draw or combo
  if (outs >= 8) return 3;  // OESD
  if (outs >= 4) return 2;  // gutshot
  if (outs >= 2) return 1;  // backdoor
  return 0;
}
