import { Card } from '../engine/types';
import { SimPlayer, SimAction, DecisionContext } from './table';
import { handPercentile } from '../engine/equity/monte-carlo';
import { evaluate7, evaluate6, evaluate5 } from '../engine/hand-evaluator';

/**
 * Cheap hand-strength proxy in 0..1 for the scripted bots.
 *
 * Deliberately not Monte Carlo: bots make several decisions per hand and
 * running simulations for each of them dominates the runtime, capping how
 * many hands we can evaluate. These archetypes only need to be consistent
 * and roughly sane, not accurate — the hero uses the real equity engine.
 */
// Exported so the adaptive bot can judge showdown strength with exactly the
// same yardstick the fixed bots use — two different measures of "strong"
// would make its reads incomparable to their behaviour.
export function quickStrength(hole: [Card, Card], board: Card[]): number {
  const all = [...hole, ...board];
  const rank = all.length >= 7 ? evaluate7(all)
    : all.length === 6 ? evaluate6(all)
    : evaluate5(all);
  const category = rank >> 20;

  let base: number;
  switch (category) {
    case 0: { // high card
      const hi = Math.max(hole[0].rank, hole[1].rank);
      base = 0.12 + (hi - 2) / 12 * 0.16;      // 0.12 .. 0.28
      break;
    }
    case 1: { // a pair — is it top pair?
      const topBoard = Math.max(...board.map(c => c.rank));
      const paired = hole.some(h => board.some(b => b.rank === h.rank));
      const pocket = hole[0].rank === hole[1].rank;
      if (pocket && hole[0].rank > topBoard) base = 0.68;      // overpair
      else if (paired && hole.some(h => h.rank === topBoard)) base = 0.58; // top pair
      else if (paired || pocket) base = 0.42;                  // weaker pair
      else base = 0.22;                                        // board pair only
      break;
    }
    case 2: base = 0.74; break;   // two pair
    case 3: base = 0.85; break;   // trips
    case 4: base = 0.90; break;   // straight
    case 5: base = 0.93; break;   // flush
    default: base = 0.97; break;  // boat or better
  }

  // Credit obvious draws while cards are still to come
  if (board.length < 5 && category < 4) {
    const suits = [0, 0, 0, 0];
    for (const c of all) suits[c.suit]++;
    if (Math.max(...suits) === 4) base = Math.max(base, 0.45);
    const ranks = [...new Set(all.map(c => c.rank))].sort((a, b) => a - b);
    let run = 1, best = 1;
    for (let i = 1; i < ranks.length; i++) {
      run = ranks[i] === ranks[i - 1] + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    if (best >= 4) base = Math.max(base, 0.42);
  }

  return base;
}

/**
 * Scripted opponents spanning the styles the advisor claims to exploit.
 * They're intentionally simple and consistent — the point is to have a
 * stable yardstick, not to build strong AI. Each has a clear leak, which
 * is what makes "does the advisor actually punish it?" a meaningful test.
 */

export interface BotConfig {
  name: string;
  /** Fraction of starting hands played (top X% by strength). */
  vpip: number;
  /** Of hands played, how often they raise rather than call. */
  raiseBias: number;
  /** Equity needed to continue postflop when facing a bet. */
  callThreshold: number;
  /** Chance of firing a bet when checked to postflop. */
  betFrequency: number;
  /** Chance of bluffing with a hand below the call threshold. */
  bluffFrequency: number;
  /**
   * Fold this often when facing a bet without a strong hand.
   *
   * An equity threshold cannot reproduce a measured fold rate: the bot's
   * strength model is clumpy, and between 0.42 and 0.44 the observed rate
   * jumps from 39% to 71% with nothing in between. A real player's
   * fold-to-c-bet is a number we HAVE, so it is set directly rather than
   * reverse-engineered out of a threshold that cannot express it.
   *
   * Unset keeps the threshold behaviour, so the hand-tuned archetypes are
   * untouched.
   */
  foldTendency?: number;
}

export const BOT_STYLES: Record<string, BotConfig> = {
  nit: {
    name: 'Nit', vpip: 0.12, raiseBias: 0.6, callThreshold: 0.62,
    betFrequency: 0.35, bluffFrequency: 0.03
  },
  station: {
    name: 'Station', vpip: 0.60, raiseBias: 0.08, callThreshold: 0.22,
    betFrequency: 0.20, bluffFrequency: 0.05
  },
  tag: {
    name: 'TAG', vpip: 0.24, raiseBias: 0.65, callThreshold: 0.50,
    betFrequency: 0.60, bluffFrequency: 0.20
  },
  lag: {
    name: 'LAG', vpip: 0.42, raiseBias: 0.70, callThreshold: 0.42,
    betFrequency: 0.70, bluffFrequency: 0.33
  },
  maniac: {
    name: 'Maniac', vpip: 0.80, raiseBias: 0.80, callThreshold: 0.28,
    betFrequency: 0.80, bluffFrequency: 0.55
  },
};

export class ScriptedBot implements SimPlayer {
  readonly name: string;
  constructor(private cfg: BotConfig, suffix = '') {
    this.name = cfg.name + suffix;
  }

  decide(ctx: DecisionContext): SimAction {
    return ctx.street === 'preflop' ? this.preflop(ctx) : this.postflop(ctx);
  }

  private preflop(ctx: DecisionContext): SimAction {
    const pct = handPercentile(ctx.holeCards[0], ctx.holeCards[1]);
    const facingRaise = ctx.toCall > ctx.bigBlind - ctx.myCommitted;

    // Tighten up against a raise — even loose players fold some junk
    const threshold = facingRaise ? this.cfg.vpip * 0.6 : this.cfg.vpip;
    if (pct > threshold) {
      return ctx.toCall > 0 ? { type: 'fold' } : { type: 'check' };
    }

    if (ctx.rng() < this.cfg.raiseBias) {
      const openTo = ctx.toCall > 0
        ? Math.max(ctx.minRaiseTo, (ctx.myCommitted + ctx.toCall) * 3)
        : ctx.bigBlind * 3;
      return { type: 'raise', to: Math.round(openTo) };
    }
    return ctx.toCall > 0 ? { type: 'call' } : { type: 'check' };
  }

  private postflop(ctx: DecisionContext): SimAction {
    let equity = quickStrength(ctx.holeCards, ctx.board);
    // Marginal hands are worth less against more opponents
    if (ctx.numActive > 2 && equity < 0.85) {
      equity *= Math.pow(0.88, ctx.numActive - 2);
    }

    if (ctx.toCall > 0) {
      // Raise for value with a genuinely strong hand
      if (equity > 0.75 && ctx.rng() < this.cfg.raiseBias) {
        return { type: 'raise', to: Math.round(ctx.minRaiseTo + ctx.pot * 0.5) };
      }
      /**
       * `callThreshold` IS the player's stickiness, so it has to be the only
       * gate.
       *
       * This used to be `equity >= callThreshold || equity > price * 1.1`,
       * and the price clause swallowed the threshold whole: a half-pot bet
       * prices at 0.33, so anything above ~0.37 called no matter what the
       * threshold said. Raising it from 0.37 to 0.68 changed the measured
       * fold rate by exactly nothing.
       *
       * The effect was that every archetype played the same postflop. The
       * Nit (0.62) and the Station (0.22) were both calling everything above
       * roughly 0.37, which is most of why the "vs Nit" column has been
       * stuck at noise all along.
       *
       * A station calling below the correct price and a nit folding above it
       * are exactly the leaks these bots exist to have.
       */
      // A measured fold rate, when we have one, beats an inferred threshold
      if (this.cfg.foldTendency !== undefined) {
        return ctx.rng() < this.cfg.foldTendency ? { type: 'fold' } : { type: 'call' };
      }

      if (equity >= this.cfg.callThreshold) {
        return { type: 'call' };
      }
      // Occasional bluff-raise
      if (ctx.rng() < this.cfg.bluffFrequency * 0.3) {
        return { type: 'raise', to: Math.round(ctx.minRaiseTo + ctx.pot * 0.4) };
      }
      return { type: 'fold' };
    }

    // Checked to us
    const value = equity > 0.62;
    const bluff = equity < 0.35 && ctx.rng() < this.cfg.bluffFrequency;
    if ((value && ctx.rng() < this.cfg.betFrequency) || bluff) {
      const size = value ? 0.7 : 0.5;
      return { type: 'raise', to: Math.round(ctx.pot * size) };
    }
    return { type: 'check' };
  }
}

/** Plays every hand and calls everything — a pure calibration baseline. */
export class CallingMachine implements SimPlayer {
  readonly name = 'AlwaysCall';
  decide(ctx: DecisionContext): SimAction {
    return ctx.toCall > 0 ? { type: 'call' } : { type: 'check' };
  }
}

/** Folds everything not already free — the floor any winner must beat. */
export class FoldBot implements SimPlayer {
  readonly name = 'AlwaysFold';
  decide(ctx: DecisionContext): SimAction {
    return ctx.toCall > 0 ? { type: 'fold' } : { type: 'check' };
  }
}

export function makeBot(style: keyof typeof BOT_STYLES, suffix = ''): ScriptedBot {
  return new ScriptedBot(BOT_STYLES[style], suffix);
}

export type { Card };

/**
 * Build a bot from a real player's measured statistics.
 *
 * This is how "are we better against THIS person" becomes measurable at all:
 * the scripted archetypes are caricatures, but a bot whose frequencies match
 * someone's actual tracked numbers plays the same shape of poker they do.
 *
 * What it is not: the person. It has none of their timing, their tilt, their
 * adaptation, or anything the four numbers below fail to capture. It answers
 * "does our strategy beat these tendencies", which is a narrower and more
 * honest question than "does it beat them".
 */
export function botFromStats(stats: {
  name: string;
  /** Fraction of hands they voluntarily play. */
  vpip: number;
  /** Fraction of hands they raise preflop. */
  pfr: number;
  /** How often they bet the flop as preflop aggressor. */
  cbet: number;
  /** How often they fold when c-bet at. Higher = tighter postflop. */
  foldToCbet: number;
  /** Fraction of showdowns where they turned over junk. */
  showdownJunk: number;
}): ScriptedBot {
  // Of the hands they enter, what share are raises rather than calls
  const raiseBias = stats.vpip > 0 ? Math.min(1, stats.pfr / stats.vpip) : 0.5;

  // Fold-to-c-bet is the postflop continuing threshold seen from the other
  // side: someone who folds to 57% of c-bets is continuing with the top 43%
  // of their equity distribution. Calibrated against the observed rate by
  // simulate-vs.ts rather than trusted as-is.
  const callThreshold = 0.20 + stats.foldToCbet * 0.30;

  // Showing down junk means bluffing and barrelling light
  const bluffFrequency = Math.max(0.02, Math.min(0.5, stats.showdownJunk * 0.4));

  return new ScriptedBot({
    name: stats.name,
    vpip: stats.vpip,
    raiseBias,
    callThreshold,
    betFrequency: stats.cbet,
    bluffFrequency,
    // Set directly: this is a number we measured, not one to infer
    foldTendency: stats.foldToCbet,
  });
}
