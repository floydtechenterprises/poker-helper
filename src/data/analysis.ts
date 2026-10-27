import { HandRecord } from './db';

/**
 * "Why am I losing to this player?" as a computation rather than a feeling.
 *
 * "He kept having stronger hands" and "I called big bets when I was behind"
 * are different problems with opposite fixes — the first is variance and the
 * answer is to keep playing, the second is a leak and the answer is to stop
 * calling. Guessing between them from memory is how people tilt.
 *
 * Deliberately returns data, not text: the CLI and the popup both render
 * this, and duplicating the reasoning in two places is how the two quietly
 * start disagreeing.
 */

export interface BigLoss {
  net: number;
  holeCards: string[];
  board: string[];
  villainShowed?: string[];
  biggestBet?: { street: string; fraction: number };
}

export interface HandAnalysis {
  /** Hands considered after filtering to the named opponent. */
  hands: number;
  totalRecorded: number;
  won: number;
  lost: number;
  folded: number;
  unclear: number;

  /** Win rate over hands with a definite result, and what luck alone explains. */
  decided: number;
  winRate: number | null;
  luckLow: number;
  luckHigh: number;
  insideLuckRange: boolean;

  /** Chip totals, only over hands that recorded an amount. */
  handsWithAmounts: number;
  netChips: number | null;
  biggestLosses: BigLoss[];
  /** Share of all losses concentrated in the single worst hand. */
  worstShare: number | null;

  /** Hands where they bet 70%+ of pot, and how we did continuing. */
  bigBetHands: number;
  bigBetContinued: number;
  bigBetWon: number;

  /** Starting-hand strength at showdowns, 0 = premium, 1 = junk. */
  showdownsCompared: number;
  theirAverage: number | null;
  ourAverage: number | null;

  /** Every distinct opponent name seen, for when a filter matches nothing. */
  namesSeen: string[];
}

const RANKS = '23456789TJQKA';

/**
 * Rough starting-hand tier, 0 (strongest) to 1 (weakest).
 *
 * Only ever used to compare two showdowns against each other, so it needs
 * to order hands sensibly rather than be exact.
 */
export function startingStrength(cards: string[] | undefined): number | null {
  if (!cards || cards.length < 2) return null;
  const r1 = RANKS.indexOf(cards[0][0]);
  const r2 = RANKS.indexOf(cards[1][0]);
  if (r1 < 0 || r2 < 0) return null;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const suited = cards[0].slice(-1) === cards[1].slice(-1);
  let score = hi / 12;
  if (r1 === r2) score += 0.9;
  else {
    score += lo / 24;
    if (suited) score += 0.12;
    if (hi - lo === 1) score += 0.08;
    if (hi - lo > 4) score -= 0.12;
  }
  return Math.max(0, Math.min(1, 1 - score / 1.9));
}

/**
 * The win rate range that pure chance explains at this sample size.
 *
 * Two standard errors on a coin flip. It is a very wide band at small
 * samples, which is the honest answer to "am I losing because I'm worse?"
 * after a dozen hands.
 */
export function luckRange(n: number): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const se = Math.sqrt(0.25 / n);
  return { lo: Math.max(0, 0.5 - 2 * se), hi: Math.min(1, 0.5 + 2 * se) };
}

/**
 * Which opponent a hand is attributed to: the one asked for, else whoever
 * actually won the pot. Taking the first in the list showed a bet size and
 * showdown from someone who folded on the flop — worse than showing
 * nothing, because it reads as an explanation.
 */
export function blameFor(
  villains: HandRecord['villains'], who: string | undefined,
) {
  if (!villains || villains.length === 0) return undefined;
  if (who) return villains.find(v => v.name.toLowerCase() === who.toLowerCase());
  return villains.reduce((best, v) => (v.net > best.net ? v : best), villains[0]);
}

/** Cards as "Ah", for display and for startingStrength. */
/** Matches the engine cardToString, which takes a typed Card. */
export type CardToString = (c: any) => string;

export function analyseHands(
  all: HandRecord[],
  who: string | undefined,
  cardToString: CardToString,
): HandAnalysis {
  const namesSeen = new Set<string>();
  for (const h of all) for (const n of h.players || []) namesSeen.add(n);

  const hands = who
    ? all.filter(h => (h.players || []).some(p => p.toLowerCase() === who.toLowerCase())
        || (h.villains || []).some(v => v.name.toLowerCase() === who.toLowerCase()))
    : all;

  let won = 0, lost = 0, folded = 0, unclear = 0;
  for (const h of hands) {
    if (h.result === 'win') won++;
    else if (h.result === 'loss') lost++;
    else if (h.result === 'fold') folded++;
    else unclear++;
  }

  const decided = won + lost;
  const winRate = decided > 0 ? won / decided : null;
  const { lo, hi } = luckRange(decided);

  // Chips: only hands that actually recorded an amount. Losses used to
  // store zero, so older records genuinely cannot answer this.
  const withNet = hands.filter(h => typeof h.net === 'number');
  const netChips = withNet.length > 0
    ? withNet.reduce((s, h) => s + (h.net || 0), 0)
    : null;

  const losses = withNet
    .filter(h => (h.net || 0) < 0)
    .sort((a, b) => (a.net || 0) - (b.net || 0));

  const biggestLosses: BigLoss[] = losses.slice(0, 5).map(h => {
    const v = blameFor(h.villains, who);
    return {
      net: h.net || 0,
      holeCards: (h.holeCards || []).map(cardToString),
      board: (h.communityCards || []).map(cardToString),
      villainShowed: v?.showed ? v.showed.map(cardToString) : undefined,
      biggestBet: v?.biggestBet,
    };
  });

  const totalLost = losses.reduce((s, h) => s + Math.abs(h.net || 0), 0);
  const worstShare = totalLost > 0 ? Math.abs(losses[0].net || 0) / totalLost : null;

  /**
   * The specific suspicion: calling big bets while behind.
   *
   * Scoped to the player being asked about. This counted a big bet from ANY
   * villain in the hand, so in a multiway pot someone else's overbet was
   * filed against the opponent under investigation — and the report then
   * explained your losses to noob using a hand where a third player did the
   * betting.
   *
   * `blameFor` already resolves "which villain does this hand belong to",
   * and using it here makes the numerator, the denominator and the biggest
   * losses all describe the same person.
   */
  const bigBet = hands.filter(h => {
    const v = blameFor(h.villains, who);
    return (v?.biggestBet?.fraction ?? 0) >= 0.7;
  });
  // 'unclear' can count as neither continuing nor folding — including it
  // inflated the denominator of the very statistic being tested
  const continued = bigBet.filter(h => h.result === 'win' || h.result === 'loss');

  // Were they simply dealt better?
  const pairs: { theirs: number; ours: number }[] = [];
  for (const h of hands) {
    const v = blameFor(h.villains, who);
    if (!v?.showed) continue;
    const theirs = startingStrength(v.showed.map(cardToString));
    const ours = startingStrength((h.holeCards || []).map(cardToString));
    if (theirs !== null && ours !== null) pairs.push({ theirs, ours });
  }

  return {
    hands: hands.length,
    totalRecorded: all.length,
    won, lost, folded, unclear,
    decided,
    winRate,
    luckLow: lo,
    luckHigh: hi,
    insideLuckRange: winRate !== null && winRate >= lo && winRate <= hi,
    handsWithAmounts: withNet.length,
    netChips,
    biggestLosses,
    worstShare,
    bigBetHands: bigBet.length,
    bigBetContinued: continued.length,
    bigBetWon: continued.filter(h => h.result === 'win').length,
    showdownsCompared: pairs.length,
    theirAverage: pairs.length > 0
      ? pairs.reduce((s, x) => s + x.theirs, 0) / pairs.length : null,
    ourAverage: pairs.length > 0
      ? pairs.reduce((s, x) => s + x.ours, 0) / pairs.length : null,
    namesSeen: [...namesSeen],
  };
}
