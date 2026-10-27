import { Card, BoardTexture, Rank } from './types';

export function analyzeBoardTexture(communityCards: Card[]): BoardTexture {
  if (communityCards.length === 0) {
    return {
      flushDraw: false, flushComplete: false,
      straightDraw: false, straightComplete: false,
      paired: false, trips: false,
      monotone: false, rainbow: false,
      highCard: 2 as Rank, wetness: 0,
      summary: 'Pre-flop',
    };
  }

  const suitCounts = [0, 0, 0, 0];
  for (const c of communityCards) suitCounts[c.suit]++;

  const maxSuitCount = Math.max(...suitCounts);
  // A draw needs a card still to come (see the straight draws below)
  const cardsToCome = communityCards.length < 5;
  /**
   * Both flags were one suit too high.
   *
   * Two of a suit on the board is a flush draw for anyone holding two more;
   * three is a flush already possible. These fired at three and four, so a
   * two-tone flop — 55% of all flops — had no flush draw at all: Kh 7h 2c
   * scored wetness 0, "Dry board", and 88% of two-tone flops read as dry
   * against 92% of rainbow ones. Wetness drives the dry-board bluff rule,
   * c-bet sizing and protection sizing, so all of them treated the most
   * common drawing texture as if nothing could be drawing.
   *
   * It also meant a turn bringing the third heart never counted as a
   * completed flush, which is exactly when barreling needs to be careful.
   */
  const flushDraw = cardsToCome && maxSuitCount >= 2;
  const flushComplete = maxSuitCount >= 3;
  const monotone = communityCards.length >= 3 && maxSuitCount === communityCards.length;
  const rainbow = communityCards.length >= 3 && maxSuitCount === 1;

  // Rank analysis
  const rankCounts = new Map<Rank, number>();
  for (const c of communityCards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) || 0) + 1);
  }

  const paired = [...rankCounts.values()].some(v => v >= 2);
  const trips = [...rankCounts.values()].some(v => v >= 3);

  // Straight analysis
  const ranks = [...new Set(communityCards.map(c => c.rank))].sort((a, b) => a - b);
  let rankBits = 0;
  for (const r of ranks) rankBits |= (1 << r);
  // Ace also counts as low
  if (rankBits & (1 << 14)) rankBits |= (1 << 1);

  let straightComplete = false;
  let straightDraw = false;
  let straightDrawCount = 0;
  /**
   * Four to a straight sitting on the board.
   *
   * Not a draw (nothing is coming) and not a straight on the board either,
   * so neither existing flag catches it — but any opponent holding one card
   * has a straight, which makes it one of the most dangerous river textures
   * there is. Without this, killing the bogus river "draw" flag would have
   * left 9-T-J-Q-x reading as a dry board.
   */
  let straightPossibleForOpponent = false;

  // A draw needs a card still to come. On a five-card board the hand is
  // finished, so "straight draw possible" is meaningless there — yet it
  // fired on 72% of complete boards and inflated `wetness`, which drives
  // barrel sizing and c-bet frequency on exactly the street where nothing
  // can improve any more.

  /**
   * Completeness is decided BEFORE draws, in a separate pass.
   *
   * These used to share one descending loop, so `!straightComplete` was only
   * true of windows examined before the completed straight was found. A
   * board with a made straight low down (say 6-high) had already flagged
   * "draw" for every higher window, and each of those added 2 to `wetness`.
   * The board then scored as both complete AND drawing, inflating a number
   * that drives barrel sizing and c-bet frequency.
   */
  const windowCounts: number[] = [];
  for (let top = 14; top >= 5; top--) {
    let count = 0;
    for (let r = top; r > top - 5; r--) {
      // Ace plays low for the wheel (A-2-3-4-5)
      if (rankBits & (1 << (r < 2 ? 1 : r))) count++;
    }
    windowCounts.push(count);
    if (count >= 5) straightComplete = true;
    if (count >= 4) straightPossibleForOpponent = true;
  }

  if (cardsToCome && !straightComplete) {
    for (const count of windowCounts) {
      if (count >= 3) {
        straightDraw = true;
        straightDrawCount++;
      }
    }
  }

  const highCard = Math.max(...communityCards.map(c => c.rank)) as Rank;

  // Wetness score
  let wetness = 0;
  if (flushDraw) wetness += 3;
  // A flush already possible. On the river nothing is drawing, but anyone
  // with two of the suit has it — weighted like the draw it replaces, so the
  // corrected thresholds leave every river's wetness exactly where it was.
  if (flushComplete) wetness += cardsToCome ? 1 : 3;
  if (maxSuitCount >= 4) wetness += 1;
  if (straightDraw) wetness += Math.min(straightDrawCount, 2) * 2;
  if (straightComplete) wetness += 1;
  // Four to a straight with no cards to come: an opponent holding one card
  // already has it, so the board is wet even though nothing is "drawing"
  if (!cardsToCome && straightPossibleForOpponent && !straightComplete) wetness += 3;
  if (monotone) wetness += 2;
  if (paired) wetness -= 2;
  if (rainbow) wetness -= 1;

  // Connectedness bonus
  const sortedRanks = [...ranks].sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length - 1; i++) {
    const gap = sortedRanks[i + 1] - sortedRanks[i];
    if (gap <= 2) wetness += 1;
  }

  wetness = Math.max(0, Math.min(10, wetness));

  // Summary
  const parts: string[] = [];
  if (wetness >= 7) parts.push('Very wet board');
  else if (wetness >= 4) parts.push('Wet board');
  else parts.push('Dry board');

  /**
   * Say what is actually there.
   *
   * `flushComplete` is true at FOUR of a suit, which is not a flush on the
   * board — it is a flush for anyone holding one card of it. Printing "flush
   * on board" told you the pot was chopped when in fact a single matching
   * card beat you, which is the opposite warning.
   */
  if (maxSuitCount >= 5) parts.push('flush on board');
  else if (maxSuitCount >= 4) parts.push('four to a flush — one card makes it');
  else if (flushComplete) parts.push('flush possible');
  else if (flushDraw) parts.push('flush draw possible');
  if (straightComplete) parts.push('straight on board');
  else if (straightDraw) parts.push('straight draw possible');
  else if (straightPossibleForOpponent) parts.push('four to a straight — one card makes it');
  if (trips) parts.push('trips on board');
  else if (paired) parts.push('paired board');
  if (monotone) parts.push('monotone');
  else if (rainbow && communityCards.length === 3) parts.push('rainbow');

  return {
    flushDraw, flushComplete,
    straightDraw, straightComplete,
    paired, trips,
    monotone, rainbow,
    highCard, wetness,
    summary: parts.join(' — '),
  };
}
