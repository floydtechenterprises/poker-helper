import { Card, Rank } from '../types';

/**
 * What our cards remove from the opponent's range.
 *
 * `blocksFlush`, `blocksTopSet`, `blocksTopPair` and `nutFlushBlockerSuit`
 * used to live here and were read by nothing. One of them was actively
 * misleading: `blocksTopSet` was set for ANY board rank we hold, not the top
 * one, so it announced a top-set blocker while holding the deuce on an
 * ace-high board.
 *
 * The two flags that survive are the two that reach a decision. The bluff
 * bonus and the notes are unchanged — the scoring was never the problem.
 */
export interface BlockerAnalysis {
  blocksNutFlush: boolean;
  blocksStraight: boolean;
  bluffValueBoost: number; // 0-30 bonus confidence for bluffs
  notes: string[];
}

export function analyzeBlockers(
  holeCards: [Card, Card],
  communityCards: Card[],
): BlockerAnalysis {
  const result: BlockerAnalysis = {
    blocksNutFlush: false,
    blocksStraight: false,
    bluffValueBoost: 0,
    notes: [],
  };

  if (communityCards.length < 3) return result;

  // Flush blocker analysis
  const suitCounts = [0, 0, 0, 0];
  for (const c of communityCards) suitCounts[c.suit]++;

  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] >= 3) {
      // Flush-possible suit found
      const holeSuitCards = holeCards.filter(c => c.suit === s);

      if (holeSuitCards.some(c => c.rank === 14)) {
        result.blocksNutFlush = true;
        result.bluffValueBoost += 15;
        result.notes.push('You hold the nut flush blocker — opponents are less likely to have the flush');
      } else if (holeSuitCards.some(c => c.rank >= 12)) {
        result.bluffValueBoost += 8;
        result.notes.push('You block strong flush holdings');
      }
    }
  }

  // Top pair / set blockers
  const boardRanks = communityCards.map(c => c.rank).sort((a, b) => b - a);
  const topBoardRank = boardRanks[0];

  // Once per HAND, not once per card. A pocket pair matching the top board
  // rank hit this twice — double the bluff bonus and the same note printed
  // twice in the reasoning list.
  if (holeCards.some(h => h.rank === topBoardRank)) {
    result.bluffValueBoost += 5;
    result.notes.push('You block top pair combos');
  }

  // Check if we block sets (holding a card that matches a board card)
  for (const hole of holeCards) {
    if (boardRanks.includes(hole.rank)) {
      result.bluffValueBoost += 5;
      result.notes.push(`You block a set of ${rankName(hole.rank)}s`);
      break;
    }
  }

  // Straight blockers — do we hold key connecting cards?
  const allRanks = new Set(communityCards.map(c => c.rank));
  for (let top = 14; top >= 5; top--) {
    let boardCount = 0;
    const missing: number[] = [];
    for (let r = top; r > top - 5; r--) {
      const actual = r < 2 ? 14 : r;
      if (allRanks.has(actual as Rank)) boardCount++;
      else missing.push(actual);
    }
    if (boardCount >= 3 && missing.length <= 2) {
      // Straight is possible — do we block the missing cards?
      for (const hole of holeCards) {
        if (missing.includes(hole.rank)) {
          result.blocksStraight = true;
          result.bluffValueBoost += 7;
          result.notes.push(`You block the straight by holding the ${rankName(hole.rank)}`);
          break;
        }
      }
      if (result.blocksStraight) break;
    }
  }

  result.bluffValueBoost = Math.min(30, result.bluffValueBoost);
  return result;
}

function rankName(r: Rank): string {
  const names: Record<number, string> = {
    14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
  };
  return names[r] || String(r);
}
