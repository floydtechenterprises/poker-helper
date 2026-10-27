import { isLegacy } from './legacy';
import { Card } from './types';

/**
 * Choosing between two lines with the same hand, without being predictable.
 *
 * A strategy that always takes the same action with the same holding is
 * readable, and readable is expensive against anyone paying attention: once
 * they know a re-raise means a premium, they fold to every one of them and
 * your best hands stop getting paid. The fix is to take each line some
 * fraction of the time — but "some fraction of the time" cannot mean
 * `Math.random()` here.
 *
 * The advisor recomputes on every DOM mutation, several times per second.
 * A random draw would give a different answer each time, so the panel would
 * flicker between RAISE and CALL while the user is trying to act on it —
 * which is both unusable and, worse, lets them re-roll until they see the
 * answer they wanted, which is no strategy at all.
 *
 * So the draw is a hash of the cards themselves. The same hand in the same
 * spot always resolves the same way, and it is stable for as long as that
 * hand lasts; a different hand resolves independently. Across a session the
 * frequencies come out right, and within a hand the advice does not move.
 */

/** Order-independent, so AhKs and KsAh are the same hand. */
function hashCards(cards: Card[], salt: string): number {
  const codes = cards.map(c => c.rank * 4 + c.suit).sort((a, b) => a - b);
  let h = 2166136261;
  for (const code of codes) {
    h ^= code;
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final avalanche, so neighbouring hands do not land on neighbouring values
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Take this line with probability `frequency`, decided by the cards.
 *
 * `salt` separates independent decisions on the same hand: without it, a
 * hand that resolved "yes" for one mix would resolve "yes" for every other
 * mix at the same frequency, so the choices would be perfectly correlated
 * and the mixing would be an illusion. Pass something that names the spot.
 */
/**
 * A separate `mixingEnabled` flag used to live here, doing the same job as
 * `isLegacy()` and set by nothing once the legacy switch existed. Two flags
 * gating one behaviour is how a harness ends up disabling the one nobody
 * remembered — this project already has five documented cases of duplicated
 * logic drifting apart, each with a comment promising to keep them in sync.
 * There is one switch now.
 */
export function mixIn(
  cards: Card[], salt: string, frequency: number,
): boolean {
  if (isLegacy()) return false;
  if (frequency >= 1) return true;
  if (frequency <= 0) return false;
  return hashCards(cards, salt) < frequency;
}

/**
 * Bend a mixing frequency toward the better candidates.
 *
 * A flat frequency treats every eligible hand alike, so "bluff 40% of your
 * candidates" picked A5s and 43s equally often — even though A5s blocks the
 * hands that call and makes the nut flush, and 43s does neither. Among hands
 * that are all technically eligible, some are plainly better, and a coin flip
 * throws that information away.
 *
 * The obvious alternative — always take the best 40%, deterministically — is
 * worse than it looks. It is a strategy an opponent can memorise: once he
 * knows suited aces always re-raise and suited connectors never do, the mix
 * has become a tell with extra steps. So quality shifts the ODDS rather than
 * deciding the outcome, and the hash still resolves it.
 *
 * The multiplier is bounded so no hand is certain and none is impossible, and
 * it is centred on the typical candidate, so the average frequency across the
 * pool stays close to the one the caller asked for — the opponent-driven
 * frequency from counter-exploit still means what it says.
 */
export function weightedFrequency(
  base: number, quality: number, typicalQuality = 52,
): number {
  if (base <= 0 || base >= 1) return base;
  const multiplier = Math.max(0.5, Math.min(1.6, 1 + (quality - typicalQuality) * 0.05));
  /**
   * Never certain, however good the hand and however soft the read.
   *
   * The clamp used to be `Math.min(1, ...)`, which the comment above already
   * described as impossible — and it was reachable: the counter-exploit
   * raises the bluff frequency to 0.65 against someone who folds to
   * everything, and 0.65 x 1.6 exceeds 1. The best bluff candidates would
   * then re-raise EVERY time, which is a pure strategy, learnable in a
   * session, and precisely the tell this whole module exists to remove. The
   * hardest read to exploit would have produced the most exploitable range.
   */
  return Math.max(0, Math.min(MAX_MIX_FREQUENCY, base * multiplier));
}

/**
 * No mixed line is ever taken every single time.
 *
 * A frequency of 1 is not a mix, it is a rule, and rules are what get read.
 */
export const MAX_MIX_FREQUENCY = 0.85;
