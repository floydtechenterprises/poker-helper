import { Card, Rank, BoardTexture, Street } from '../types';

export interface RangeRepresentation {
  canRepresentFlush: boolean;
  canRepresentStraight: boolean;
  canRepresentOverpair: boolean;
  canRepresentSet: boolean;
  canRepresentTopPair: boolean;
  credibility: number; // 0-100: how believable is a big bet from you?
  bestStory: string;
  notes: string[];
}

export function analyzeRangeRepresentation(
  holeCards: [Card, Card],
  communityCards: Card[],
  boardTexture: BoardTexture,
  street: Street,
  isPreflopRaiser: boolean,
  /** Acting last after the flop, from the seats — see heroHasPosition. */
  hasPosition: boolean,
): RangeRepresentation {
  const result: RangeRepresentation = {
    canRepresentFlush: false,
    canRepresentStraight: false,
    canRepresentOverpair: false,
    canRepresentSet: false,
    canRepresentTopPair: false,
    credibility: 30,
    bestStory: '',
    notes: [],
  };

  if (communityCards.length < 3) return result;

  const boardRanks = communityCards.map(c => c.rank).sort((a, b) => b - a);
  const topBoardRank = boardRanks[0];

  // Can we represent a flush?
  // A flush has to be possible to be represented. This read
  // `flushComplete || flushDraw` when those meant four and three of a suit;
  // with the thresholds corrected, three of a suit is `flushComplete` alone.
  if (boardTexture.flushComplete) {
    // Pre-flop raisers have suited broadways in their range
    if (isPreflopRaiser) {
      result.canRepresentFlush = true;
      result.credibility += 15;
      result.notes.push('Can credibly represent a flush from your range');
    }
  }

  // Can we represent a straight?
  if (boardTexture.straightComplete || boardTexture.straightDraw) {
    // Check if connectors in our "range" could make the straight
    const possibleStraights = findPossibleStraights(communityCards);
    if (possibleStraights.length > 0) {
      result.canRepresentStraight = true;
      result.credibility += 10;
      result.notes.push('Board allows straight — can represent it');
    }
  }

  // Can we represent an overpair?
  if (isPreflopRaiser && topBoardRank <= 12) {
    result.canRepresentOverpair = true;
    result.credibility += 15;
    result.notes.push('As pre-flop raiser, you credibly have AA/KK/QQ');
  }

  // Can we represent a set?
  // PFR has pocket pairs in range, and any board card can make a set
  if (isPreflopRaiser) {
    const highBoardCards = boardRanks.filter(r => r >= 10);
    if (highBoardCards.length > 0) {
      result.canRepresentSet = true;
      result.credibility += 10;
      result.notes.push('Can represent a set');
    }
  }

  // Can we represent top pair?
  if (topBoardRank >= 10 && isPreflopRaiser) {
    result.canRepresentTopPair = true;
    result.credibility += 10;
  }

  // Position adjustments
  // Took the preflop label, which heads-up is 'SB' or 'BB' and never 'BTN',
  // so no one in a heads-up match ever got this.
  if (hasPosition) {
    result.credibility += 5; // wider range, more hands to represent
  }

  // Street adjustments
  if (street === 'river') {
    // On the river, the story needs to be consistent
    result.credibility -= 5;
    result.notes.push('River bluff — your line needs to tell a consistent story');
  }

  // Board coverage: low boards don't favor pre-flop raiser
  if (topBoardRank <= 8 && isPreflopRaiser) {
    result.credibility -= 15;
    result.notes.push('Low board doesn\'t favor pre-flop raiser range');
  }

  // Determine best story
  if (result.canRepresentFlush && boardTexture.flushComplete) {
    result.bestStory = 'Representing a flush';
  } else if (result.canRepresentOverpair) {
    result.bestStory = 'Representing an overpair';
  } else if (result.canRepresentStraight && boardTexture.straightComplete) {
    result.bestStory = 'Representing a straight';
  } else if (result.canRepresentSet) {
    result.bestStory = 'Representing a set';
  } else if (result.canRepresentTopPair) {
    result.bestStory = 'Representing top pair';
  } else {
    result.bestStory = 'No strong hand to represent';
    result.credibility = Math.max(10, result.credibility - 20);
  }

  /**
   * Your own cards decide whether the story is even available to you.
   *
   * `holeCards` was taken and never read, so credibility was computed purely
   * from the board and position — the function claimed to judge how
   * believable YOUR line is while ignoring what you hold. Two concrete
   * consequences:
   *
   *   - holding a card of the flush suit makes a flush story far more
   *     credible, because you block some of the hands that would call
   *   - holding NONE of the relevant cards means the story is one every
   *     opponent can also tell, which is what makes a bluff transparent
   */
  const boardSuits = [0, 0, 0, 0];
  for (const c of communityCards) boardSuits[c.suit]++;
  const flushSuit = boardSuits.findIndex(n => n >= 3);

  if (result.canRepresentFlush && flushSuit >= 0) {
    const holdsSuit = holeCards.some(c => c.suit === flushSuit);
    // A card of the suit blocks hands that would otherwise call
    result.credibility += holdsSuit ? 12 : -8;
    if (holdsSuit) result.notes.push('You hold a card of the flush suit — the story blocks their calls');
  }

  // Connecting with the board at all makes any story easier to tell
  const ranksOnBoard = new Set(communityCards.map(c => c.rank));
  const connects = holeCards.some(c => ranksOnBoard.has(c.rank))
    || holeCards.some(c => communityCards.some(b => Math.abs(b.rank - c.rank) <= 2));
  if (!connects && communityCards.length >= 3) {
    result.credibility -= 8;
    result.notes.push('Your cards miss this board entirely — the story is harder to sell');
  }

  result.credibility = Math.max(0, Math.min(100, result.credibility));
  return result;
}

function findPossibleStraights(communityCards: Card[]): number[][] {
  const ranks = new Set(communityCards.map(c => c.rank));
  if (ranks.has(14 as Rank)) ranks.add(1 as any);

  const results: number[][] = [];

  for (let top = 14; top >= 5; top--) {
    let count = 0;
    const missing: number[] = [];
    for (let r = top; r > top - 5; r--) {
      const actual = r < 2 ? 14 : r;
      if (ranks.has(actual as Rank)) count++;
      else missing.push(actual);
    }
    if (count >= 3 && missing.length <= 2) {
      results.push(missing);
    }
  }

  return results;
}
