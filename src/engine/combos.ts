import { Card, Rank } from './types';
import { createDeck } from './cards';
import { evaluate7 } from './hand-evaluator';

/**
 * Counting the hands the opponent can still actually hold.
 *
 * The equity engine already removes every visible card from the deck, so the
 * NUMBER it returns accounts for card removal correctly. What it cannot do is
 * say why. "You have 62% equity" and "he has three combinations that beat you
 * and thirty-one that do not" are the same fact, but only the second one tells
 * you whether his big bet can possibly be value.
 *
 * This is not card counting in the blackjack sense, and that distinction
 * matters: the deck is reshuffled every hand, so nothing carries between them.
 * What carries is only what is visible right now — our two cards and the
 * board — and against a paired or coordinated board that is a lot.
 *
 * The classic case is a board with three of a rank. Three queens showing
 * leaves exactly one queen in the deck, so the combinations containing one
 * collapse from sixteen to four; hold a queen yourself and there are none at
 * all. A hand that "might be trips" is arithmetically impossible, and no
 * amount of reading his betting will tell you that.
 */

export interface ComboCount {
  /** Two-card combinations that currently beat us. */
  beatsUs: number;
  /** Combinations we currently beat. */
  weBeat: number;
  /** Combinations that tie. */
  ties: number;
  /** Everything they could hold, given what we can see. */
  total: number;
  /**
   * What share of the hands they can hold beats us right now.
   *
   * The number the decision actually turns on, and NOT the same as our
   * equity: this is the count of holdings that are ahead this instant, with
   * no cards left to come factored in.
   */
  fractionAhead: number;
}

/** Every two-card combination the opponent can still hold. */
export function remainingCombos(
  ourCards: Card[], board: Card[],
): [Card, Card][] {
  const seen = new Set(
    [...ourCards, ...board].map(c => c.rank * 4 + c.suit),
  );
  const deck = createDeck().filter(c => !seen.has(c.rank * 4 + c.suit));

  const out: [Card, Card][] = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      out.push([deck[i], deck[j]]);
    }
  }
  return out;
}

/**
 * One answer per spot, kept because the spot does not change while it is
 * being looked at.
 *
 * This walks 990 seven-card evaluations, which measured 24ms — and the
 * advisor recomputes on every DOM mutation, several times a second, on the
 * page's own thread. That is roughly 120ms per second spent recomputing an
 * answer that cannot have changed: the river board and our two cards are
 * fixed for the whole decision.
 *
 * Bounded, because a long session sees thousands of distinct rivers and an
 * unbounded map on the content script is a leak that only shows up after an
 * hour of play.
 */
const comboCache = new Map<string, ComboCount>();

/** Empty it, so an A/B arm can start cold. See resetEngineCaches. */
export function clearComboCache(): void {
  comboCache.clear();
}
const MAX_COMBO_CACHE = 500;

function comboKey(ourCards: Card[], board: Card[]): string {
  const enc = (c: Card) => c.rank * 4 + c.suit;
  // Order-independent: the same seven cards are the same question however
  // the scraper happened to read them.
  return [...ourCards.map(enc)].sort((a, b) => a - b).join(',')
    + '|' + [...board.map(enc)].sort((a, b) => a - b).join(',');
}

/**
 * How many of the hands they can hold are ahead of ours right now.
 *
 * Exhaustive rather than sampled. With a full board there are at most
 * C(45,2) = 990 combinations, so this is exact — and exactness is the whole
 * point of a combinatoric argument. An approximate combo count would just be
 * the equity number wearing a disguise.
 *
 * Requires a full five-card board: with cards still to come, "ahead" is not
 * a decision-relevant fact, and equity already answers that question.
 */
export function countCombos(
  ourCards: [Card, Card], board: Card[],
): ComboCount | null {
  if (board.length !== 5) return null;

  /**
   * Refuse duplicated cards rather than counting them.
   *
   * `calculateEquity` throws on exactly this, and for the same reason: a
   * repeated card means the table was misread, and the honest response is to
   * fail rather than return a confident number computed from an impossible
   * deck. This had no guard at all, so a scraper glitch would have produced
   * a plausible count nobody could tell was wrong.
   */
  const all = [...ourCards, ...board];
  const distinct = new Set(all.map(c => c.rank * 4 + c.suit));
  if (distinct.size !== all.length) {
    throw new Error(
      `countCombos: duplicate card among ${all.length} known cards `
      + '— the table was misread',
    );
  }

  const key = comboKey(ourCards, board);
  const cached = comboCache.get(key);
  if (cached) return cached;

  const ourRank = evaluate7([...ourCards, ...board]);
  const combos = remainingCombos(ourCards, board);

  let beatsUs = 0;
  let weBeat = 0;
  let ties = 0;
  for (const combo of combos) {
    const theirRank = evaluate7([...combo, ...board]);
    if (theirRank > ourRank) beatsUs++;
    else if (theirRank < ourRank) weBeat++;
    else ties++;
  }

  const total = combos.length;
  const result: ComboCount = {
    beatsUs, weBeat, ties, total,
    fractionAhead: total > 0 ? beatsUs / total : 0,
  };

  if (comboCache.size >= MAX_COMBO_CACHE) comboCache.clear();
  comboCache.set(key, result);
  return result;
}

/**
 * Ranks the board has made effectively unavailable.
 *
 * A rank appearing three or more times between our hand and the board leaves
 * at most one of it in the deck, which is the thing worth SAYING out loud —
 * it is the difference between "he might have trips" and "he cannot".
 */
export function deadRanks(
  ourCards: Card[], board: Card[],
): { rank: Rank; seen: number; remaining: number }[] {
  const counts = new Map<Rank, number>();
  for (const c of [...ourCards, ...board]) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  const out: { rank: Rank; seen: number; remaining: number }[] = [];
  for (const [rank, seen] of counts) {
    if (seen >= 3) out.push({ rank, seen, remaining: 4 - seen });
  }
  return out.sort((a, b) => b.seen - a.seen);
}

/**
 * Both forms written out, rather than derived.
 *
 * The plural was being singularised with `replace(/e?s$/, '')`, which is
 * right for "queens" and wrong for every name whose singular already ends in
 * a vowel sound: aces became "ac", fives became "fiv", nines "nin", threes
 * "thre". The panel would have said "only one ac left in the deck".
 *
 * Thirteen pairs is less code than a rule that handles English plurals, and
 * it cannot be wrong for a case nobody thought of.
 */
const RANK_NAMES: Record<number, { one: string; many: string }> = {
  14: { one: 'ace', many: 'aces' },
  13: { one: 'king', many: 'kings' },
  12: { one: 'queen', many: 'queens' },
  11: { one: 'jack', many: 'jacks' },
  10: { one: 'ten', many: 'tens' },
  9: { one: 'nine', many: 'nines' },
  8: { one: 'eight', many: 'eights' },
  7: { one: 'seven', many: 'sevens' },
  6: { one: 'six', many: 'sixes' },
  5: { one: 'five', many: 'fives' },
  4: { one: 'four', many: 'fours' },
  3: { one: 'three', many: 'threes' },
  2: { one: 'two', many: 'twos' },
};

/**
 * The count, in a sentence, or null when there is nothing worth saying.
 *
 * Deliberately silent in the ordinary case. A note on every hand is noise,
 * and noise is what stops people reading the panel at all — the same reason
 * the health checks were changed to fire only on genuine contradictions.
 */
export function describeCombos(
  count: ComboCount | null,
  dead: { rank: Rank; seen: number; remaining: number }[],
): string | null {
  if (!count) return null;

  const parts: string[] = [];

  /**
   * Only worth saying when the answer is lopsided. Around half the
   * combinations beating us is the unremarkable case and says nothing a
   * person could act on.
   */
  if (count.beatsUs === 0 && count.weBeat === 0) {
    /**
     * Nothing beats us and nothing loses to us either.
     *
     * This is the board playing — a royal flush on the felt, say — where
     * every holding chops. "Nothing he can hold beats you" is true and
     * badly misleading here: it reads as the nuts and invites a raise into
     * a pot that cannot be won. The two cases have to be separated, because
     * `beatsUs === 0` alone does not distinguish them.
     */
    parts.push('The board plays — every hand he can hold chops with you');
  } else if (count.beatsUs === 0) {
    // "Only 0 of the 990 hands beat you" is arithmetic pretending to be a
    // sentence. Nothing beats us; say that.
    parts.push('Nothing he can hold beats you');
  } else if (count.fractionAhead <= 0.12) {
    parts.push(
      `Only ${count.beatsUs} of the ${count.total} hands he can hold beat you`,
    );
  } else if (count.fractionAhead >= 0.6) {
    parts.push(
      `${count.beatsUs} of the ${count.total} hands he can hold beat you`,
    );
  }

  for (const d of dead) {
    const name = RANK_NAMES[d.rank];
    if (!name) continue;
    if (d.remaining <= 0) {
      // "every sixes is accounted for" — the plural does not fit this
      // sentence, and the fix for the singular introduced it.
      parts.push(`all four ${name.many} are accounted for`);
    } else {
      parts.push(`only one ${name.one} left in the deck`);
    }
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Whether the counts are allowed to override a river decision.
 *
 * Exists so the change can be measured against the adaptive bot rather than
 * argued about. Every other read built today that went straight into the
 * decision on the strength of good reasoning cost money — the steal rule
 * measured -19.8 bb/100 — so this one arrives with a switch attached.
 */
let comboGuardEnabled = true;

export function setComboGuard(on: boolean): void {
  comboGuardEnabled = on;
}

/**
 * The mirror rule — folding when almost everything beats us — off by default.
 *
 * A switch rather than a hard-coded `false`, so the claim that it is a bad
 * idea can be tested instead of asserted. It was disabled on reasoning
 * alone, and today has been a long lesson in how often confident reasoning
 * about poker measures negative.
 */
let mirrorRuleEnabled = false;

/**
 * How many times each rule has actually fired.
 *
 * Diagnostics, not strategy. A measurement harness that cannot see whether
 * the thing it is A/Bing ever ran has produced three wrong numbers today: a
 * rule gated behind a branch that could never open, a bot reading blinds as
 * bets, and arms whose cards diverged. A counter is cheaper than another
 * wrong conclusion.
 */
export const guardFirings = { neverFold: 0, mirrorFold: 0 };

export function resetGuardFirings(): void {
  guardFirings.neverFold = 0;
  guardFirings.mirrorFold = 0;
}

export function setMirrorRule(on: boolean): void {
  mirrorRuleEnabled = on;
}

/**
 * Below this share of his holdings beating us, folding is indefensible.
 *
 * This is the ONE direction the count is range-independent in. If four of
 * his 990 possible hands beat us, then however he weights his betting range
 * — value-heavy, bluff-heavy, anything — at most four combinations have us
 * beaten. No read about how he bets can rescue a fold here, because the
 * cards to make a better hand are not in the deck.
 */
export const NEVER_FOLD_BELOW = 0.03;

/**
 * Above this share, calling needs a real price.
 *
 * The mirror argument is NOT symmetric, and pretending it is would be the
 * mistake. If 95% of his combinations beat us, he might still be betting the
 * other 5% as a bluff — a polarised range is exactly the weak part of the
 * distribution plus the strong part, so "most hands beat us" does not mean
 * "he probably has one of them". So this only fires when the count is
 * extreme AND the pot is not laying us a price that a bluff-catcher wants.
 */
export const CALL_NEEDS_PRICE_ABOVE = 0.94;

export interface ComboGuard {
  action: 'fold' | 'call';
  reason: string;
}

/**
 * Let the counts veto a river decision, in the ONE case they can prove.
 *
 * Deliberately narrow. The count treats every combination as equally likely,
 * which is false — he folded some preflop and would not bet others — so it
 * is not a substitute for the equity model. It is only admissible where that
 * weighting cannot change the answer, and there is exactly one such case:
 * when the cards needed to beat us are not in the deck.
 *
 * This comment used to say "the two cases where the weighting cannot matter",
 * describing a mirror rule that has since been disabled — and disabled
 * precisely BECAUSE the weighting matters for it. A stale comment asserting
 * the opposite of the code below it is how the next person reintroduces the
 * bug, so it is corrected rather than left to age.
 *
 * Returns null when the counts have nothing conclusive to add, which is
 * almost always.
 */
export function comboGuard(
  ourCards: [Card, Card],
  board: Card[],
  facingBet: boolean,
  proposed: string,
  /**
   * How OFTEN we must win to break even on the call, 0-1 — the required
   * equity from `calculatePotOdds`, not a share of the pot. The parameter
   * was documented as "share of the pot we must win", which is a different
   * quantity entirely and would be wired in wrongly by anyone re-enabling
   * the rule that consumes it.
   */
  priceNeeded: number,
): ComboGuard | null {
  if (!comboGuardEnabled) return null;
  if (!facingBet || board.length !== 5) return null;

  let count: ComboCount | null;
  try {
    count = countCombos(ourCards, board);
  } catch {
    // A misread table is not a read. See appendComboNote.
    return null;
  }
  if (!count) return null;

  if (proposed === 'fold' && count.fractionAhead <= NEVER_FOLD_BELOW) {
    /**
     * States the conclusion, not the count.
     *
     * This used to open with "Only 4 of the 990 hands he can hold beat you",
     * which is word-for-word what `describeCombos` prints on the very next
     * line — the guard only fires below 3%, and the note fires below 12%, so
     * the guard firing GUARANTEES the note fires too. The panel showed the
     * same sentence twice.
     *
     * Suppressing the note was the first fix and the wrong one: the note
     * also carries the dead-rank detail ("only one ace left in the deck"),
     * which is the most useful part. So the count is said once, by the note,
     * and this says only what the note cannot — that the fold is refuted.
     */
    guardFirings.neverFold++;
    return {
      action: 'call',
      reason: 'Folding cannot be right here whatever he is representing — '
        + 'the cards that would beat you are not in the deck',
    };
  }

  /**
   * The mirror rule is DISABLED, and the asymmetry is the reason.
   *
   * It would fold when almost everything beats us: `fractionAhead` above
   * 0.94, we beat under 5%, and the pot is not laying a bluff-catching
   * price. It is written out below and switched off, because the two
   * directions are not equally sound and measuring them together hid that.
   *
   * "Almost nothing beats us" is a theorem. The cards required to beat us
   * are not in the deck, so no weighting of his range changes the answer.
   *
   * "Almost everything beats us" is a guess about how he bets. A polarised
   * betting range is the strong hands PLUS the bluffs, so the hands we still
   * beat are exactly the ones he is most likely to be betting — the count
   * says we are behind a random holding, and he is not betting a random
   * holding. Against an opponent who bluffs more than average this rule
   * folds the winner, and it fires precisely when the pot is biggest.
   *
   * Measured together the pair came to +2.2 bb/100 ±7.6 across ten seeds:
   * positive, not significant, and unable to say which half did what. Rather
   * than ship an unproven heuristic alongside a proven one, only the proven
   * half stays on. Turning this back on means measuring it alone first.
   */
  if (mirrorRuleEnabled) {
    const weBeatShare = count.total > 0 ? count.weBeat / count.total : 0;
    if (proposed === 'call'
        && count.fractionAhead >= CALL_NEEDS_PRICE_ABOVE
        && weBeatShare < 0.05
        && priceNeeded > 0.2) {
      guardFirings.mirrorFold++;
      return {
        action: 'fold',
        reason: `${count.beatsUs} of the ${count.total} hands he can hold beat you, `
          + `and the price needs you good ${Math.round(priceNeeded * 100)}% of the time`,
      };
    }
  }

  return null;
}

/**
 * A pot-odds-aware verdict lived here and has been removed.
 *
 * `comboVerdict` returned "clear call" / "clear fold" by comparing the count
 * against the price. It was written, tested, and called from nowhere but its
 * own test — this module deliberately reports rather than decides, so nothing
 * in the advisor ever wanted a verdict.
 *
 * Dead code WITH passing tests is worse than dead code without them: the
 * suite then reports coverage of behaviour that never runs, which is the same
 * false confidence as the unreachable widen-positive branch in the button
 * range. If these counts are ever promoted to driving river calls, it comes
 * back with a measurement against the adaptive bot behind it.
 */

