/**
 * Should this bluff be fired at all?
 *
 * Self-play showed bluffing with air was the only losing action in the
 * entire strategy — every other line made money. The cause was that the
 * bluff gates checked board texture, position and player count, but never
 * whether the opponent folds. A bluff into someone who calls everything is
 * just donating, no matter how dry the board is.
 *
 * This puts the actual break-even maths in front of every bluff.
 */

export interface BluffCheck {
  profitable: boolean;
  /** Fold probability the bluff needs to break even, 0-1. */
  needed: number;
  /** What we actually estimate they'll fold, 0-1. */
  estimated: number;
  reason: string;
}

/**
 * A pure bluff of `betSize` into `pot` risks the bet to win the pot, so it
 * needs folds at least bet/(bet+pot) of the time. Backup equity lowers that
 * bar, because sometimes we win after being called.
 *
 * @param equityIfCalled our chance of winning when they don't fold (0-1)
 */
export function evaluateBluff(
  pot: number,
  betSize: number,
  foldChance: number,
  equityIfCalled = 0,
): BluffCheck {
  if (pot <= 0 || betSize <= 0) {
    return { profitable: false, needed: 1, estimated: foldChance, reason: 'no pot to win' };
  }

  // EV = fold * pot + (1 - fold) * (equity * (pot + 2*bet) - bet)
  const evWhenCalled = equityIfCalled * (pot + 2 * betSize) - betSize;
  const ev = foldChance * pot + (1 - foldChance) * evWhenCalled;

  // Break-even fold rate, given the backup equity
  const needed = evWhenCalled >= 0
    ? 0
    : Math.min(1, -evWhenCalled / (pot - evWhenCalled));

  if (ev > 0) {
    return {
      profitable: true, needed, estimated: foldChance,
      reason: `needs ${Math.round(needed * 100)}% folds, estimate ${Math.round(foldChance * 100)}%`,
    };
  }

  return {
    profitable: false, needed, estimated: foldChance,
    reason: `needs ${Math.round(needed * 100)}% folds but they only fold ~${Math.round(foldChance * 100)}%`,
  };
}

/**
 * Bluff only a fraction of your air, and always the same fraction.
 *
 * Every bluff test in the engine is a yes/no judgement about the spot, so
 * whenever a spot looked bluffable it bluffed with 100% of the air hands
 * that reached it. That is why turn bets with no pair and no draw fired
 * about as often as flop bets — the advice felt like it was constantly
 * telling you to bet nothing, and against anyone paying attention it is
 * trivially exploitable.
 *
 * Real strategy picks a *frequency* and bluffs the best-blocking hands
 * within it. This selects that subset deterministically from the actual
 * cards, so the same hand on the same board always gets the same answer —
 * re-reading the advice can never flip it, which a random roll would.
 *
 * `blockerBoost` shifts a hand up the queue: hands that block their calling
 * range are the ones that should be bluffing when we only bluff some.
 */
export function bluffFrequencyGate(
  holeCards: { rank: number; suit: number }[],
  communityCards: { rank: number; suit: number }[],
  street: 'flop' | 'turn' | 'river',
  blockerBoost: number,
  /**
   * Scales the frequency by how this specific opponent answers our bets.
   *
   * Applied here rather than at the call site so every consumer of the gate
   * gets the adjustment — a second place that decided when to bluff would be
   * a sixth copy of logic this project has already watched drift five times.
   * Defaults to 1, which leaves the calibrated frequencies exactly as they
   * were for an unknown opponent.
   */
  opponentFactor = 1,
): { allowed: boolean; frequency: number; roll: number } {
  // Flop bluffs are cheap and fold out the most, so they stay wide. A
  // second and third barrel each have to beat a hand that already called.
  // These sit downstream of the story/blocker checks, which already cull
  // rivers harder than turns, so they are calibrated against the observed
  // end-to-end bluff rate (aircheck) rather than read as frequencies
  // themselves: ~25% of turn air and ~18% of river air ends up betting.
  const base = (street === 'flop' ? 1.0 : street === 'turn' ? 0.58 : 0.80)
    * Math.max(0.2, Math.min(2, opponentFactor));

  // Good blockers earn a bigger share of the bluffing range
  const frequency = Math.max(0, Math.min(1, base + blockerBoost / 100));

  /**
   * FNV-1a over the exact cards — stable, and spreads adjacent hands apart.
   *
   * Sorted first, because the promise this function makes is that the same
   * hand on the same board always gets the same answer. Hashing in array
   * order broke that: hole cards arrive in whatever order the scraper read
   * the seat, so a re-render that returned them the other way round produced
   * a different roll and could flip the bluff decision on an unchanged spot.
   * That is precisely the flicker this gate exists to prevent.
   */
  let h = 2166136261;
  const encoded = [...holeCards, ...communityCards]
    .map(c => c.rank * 4 + c.suit)
    .sort((a, b) => a - b);
  for (const v of encoded) {
    h ^= v;
    h = Math.imul(h, 16777619);
  }
  const roll = (h >>> 0) / 4294967296;

  return { allowed: roll < frequency, frequency, roll };
}
