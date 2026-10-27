import { Card, Rank, Suit } from './types';

export const SUITS: Suit[] = [0, 1, 2, 3];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const SUIT_NAMES: Record<Suit, string> = { 0: 'c', 1: 'd', 2: 'h', 3: 's' };
export const RANK_NAMES: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

export function cardIndex(c: Card): number {
  return (c.rank - 2) * 4 + c.suit;
}

export function cardToString(c: Card): string {
  return RANK_NAMES[c.rank] + SUIT_NAMES[c.suit];
}

/**
 * Removed from this module, all of them unused:
 *
 *   `shuffleArray` — shuffled with `Math.random` rather than the seeded RNG.
 *     Harmless only because nothing called it: used in the simulator it would
 *     have silently destroyed run-to-run reproducibility, which is the exact
 *     failure that made two runs of one build differ by ten bb/100.
 *   `parseCard`  — the scraper has its own card parser; this one threw a
 *     TypeError rather than its intended error on empty input.
 *   `cardFromIndex`, `sameCard` — no callers, no validation.
 *
 * `cardIndex` stays: `createDeckExcluding` and the equity paths use it.
 */

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function createDeckExcluding(exclude: Card[]): Card[] {
  const excluded = new Set(exclude.map(cardIndex));
  return createDeck().filter(c => !excluded.has(cardIndex(c)));
}

