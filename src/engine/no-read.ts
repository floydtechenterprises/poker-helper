/**
 * What every read answers when there is nobody to read.
 *
 * This build keeps no record of any player, so none of the counter-exploit
 * surfaces the original had can ever fire. Rather than tear twenty call
 * sites out of the preflop advisor — each one a chance to change how it
 * plays by accident — the advisor keeps its shape and consults these
 * constants instead. They are exactly the values the deleted functions
 * returned when handed a player they had never seen, which is now every
 * player.
 *
 * Nothing here takes a profile, holds state, or can learn. That is the
 * point: the shape of the decision survives, the memory does not.
 */

/** How they answer our opens. Measured over nothing, so: nothing. */
export interface StealRead {
  /** How often they fold their big blind to our open. */
  foldToOpen: number | null;
  /** How often they answer our open with a re-raise. */
  threeBetRate: number | null;
  /** Net big blinds per hand on the pots we opened. */
  openProfitBB?: number | null;
  /** How many opened hands that average is drawn from. */
  openProfitSample?: number;
  sample: number;
  /**
   * How much to widen (positive) or tighten (negative) the opening range,
   * as a fraction of hands. Always zero here — widening or tightening
   * against an unknown player is not an exploit, it is a guess.
   */
  widen: number;
  note: string | null;
}

export const NO_STEAL_READ: StealRead = {
  foldToOpen: null,
  threeBetRate: null,
  openProfitBB: null,
  openProfitSample: 0,
  sample: 0,
  widen: 0,
  note: null,
};

/** How they answer our 3-bets, and what to do about it. */
export interface CounterExploit {
  /** How often good bluff candidates should 3-bet instead of calling. */
  bluffFrequency: number;
  /** How often premiums should flat instead of 3-betting. */
  premiumFlatFrequency: number;
  /** Their measured fold-to-our-3-bet. Never measured here. */
  foldToOurThreeBet: number | null;
  /** How many of our 3-bets that rate is based on. */
  sample: number;
  /** How much say the measurement has, 0-1. Always none. */
  weight: number;
  /** Which way the measurement is pulling, or null when it is not. */
  leaning: 'trap' | 'value' | null;
  /** Plain-language note for the user, or null when nothing has changed. */
  note: string | null;
}

/**
 * The priors, unchanged.
 *
 * The original started from exactly these and then moved them with what it
 * had measured. With nothing measured, the starting point is the answer —
 * which is what it did for the first several hands against anyone new.
 */
export function noCounterExploit(
  prior: { bluffFrequency: number; premiumFlatFrequency: number },
): CounterExploit {
  return {
    bluffFrequency: prior.bluffFrequency,
    premiumFlatFrequency: prior.premiumFlatFrequency,
    foldToOurThreeBet: null,
    sample: 0,
    weight: 0,
    leaning: null,
    note: null,
  };
}

/** Their fold-to-our-shove: unmeasured, forever. */
export const NO_SHOVE_RESPONSE: { rate: number | null; sample: number } = {
  rate: null,
  sample: 0,
};

/**
 * How often WE have been shoving.
 *
 * This one was never a read on them — it measured our own recent shoving so
 * fold equity could be discounted when we had been shoving too often to be
 * respected. It needed the opponent's hand record to count from, so it goes
 * with the rest, and a rate of zero means the discount below never bites.
 */
export const NO_SHOVE_RATE: { rate: number; sample: number } = {
  rate: 0,
  sample: 0,
};

/**
 * The shoving rate an opponent has no reason to adjust against.
 *
 * Kept with its original value so `discountFoldEquity` behaves identically
 * for any caller that still computes a rate of its own.
 */
export const UNREMARKABLE_SHOVE_RATE = 0.125;

/**
 * Shade a measured fold-to-shove rate down when we have been shoving more
 * than `UNREMARKABLE_SHOVE_RATE`.
 *
 * Unchanged from the original. With `NO_SHOVE_RATE.rate` of 0 the excess is
 * zero and the factor is 1, so this is the identity function in this build
 * — kept whole rather than deleted, because the caller passes a rate and
 * the arithmetic should stay honest if one ever appears again.
 */
export function discountFoldEquity(measured: number, ourRate: number): number {
  const excess = Math.max(0, ourRate - UNREMARKABLE_SHOVE_RATE);
  // Full excess (we shove every hand) costs 40% of the measured fold rate
  const factor = Math.max(0.6, 1 - excess * 0.46);
  return Math.max(0, Math.min(1, measured * factor));
}

/**
 * A read that is not there, typed so the call sites still compile.
 *
 * The preflop advisor consults an opponent read in about twenty places,
 * each one guarded by `read ? … : …` or `read?.something`. Deleting those
 * guards means rewriting twenty branches of a 1,400-line decision, and
 * every one of those rewrites is a chance to change how it plays by
 * accident — which is the one thing this change must not do.
 *
 * So the guards stay and the value is always null. A function rather than a
 * `const null` on purpose: TypeScript narrows a const initialised to null
 * down to `never` at the use sites, and then the very guards we are keeping
 * stop compiling.
 */
export function noReadOf<T>(): T | null {
  return null;
}

/** The shape the advisor expects of a read, for the guards above. */
export interface AbsentRead {
  handsTracked: number;
  vpip: number;
  showdownLooseness: number | null;
  headline: string | null;
  foldToBetOn: Record<string, number | undefined>;
  limpRate: number;
  limpFoldRate: number;
  foldToThreeBetRate: number;
  headsUp?: boolean;
  type?: string;
  rich?: {
    preflop: {
      foldToThreeBet?: { rate: number | null; opportunities: number };
    };
  };
}

/** The shape of "whoever we are up against", which is now nobody. */
export interface AbsentPrimary {
  name: string;
  profile: { name: string; handsTracked: number };
}
