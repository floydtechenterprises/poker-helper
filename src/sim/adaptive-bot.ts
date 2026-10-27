import { Card } from '../engine/types';
import { DecisionContext, SimAction, SimPlayer } from './table';
import { ScriptedBot, BotConfig } from './bots';
import { quickStrength } from './bots';
import { handPercentile } from '../engine/equity/monte-carlo';

/**
 * An opponent who watches how we play and adjusts.
 *
 * Every bot in this simulator so far plays a fixed style. That makes them
 * useful for measuring raw strategy and useless for measuring the thing this
 * project spent a day building: balance, disguise, and counter-adaptation.
 * A sizing tell costs nothing against someone who never looks at sizes, so
 * every "did this help?" question came back +0.0 and unanswerable.
 *
 * This one looks. It records what we bet, and — when a hand reaches showdown
 * — what we had. Sizes that keep showing up strong start getting folded to;
 * sizes that keep showing up weak start getting called and raised. That is
 * precisely what a human does across a few hundred hands, and it is what the
 * user described noob doing.
 *
 * INFORMATION DISCIPLINE
 *
 * The whole value of this bot is that its knowledge is honest, so what it may
 * see is deliberately narrow:
 *
 *   - our ACTIONS and bet sizes, which are public as they happen
 *   - our hole cards ONLY when a hand reaches showdown and they are turned up
 *   - the board, the pot, and the stacks
 *
 * It never sees our hole cards in a hand we won without showing, never sees
 * them while a hand is in progress, and never reads the advisor's internals.
 * A bot that cheated even slightly would make every measurement taken with it
 * worthless, and the failure would be invisible — it would simply look like
 * our strategy was worse than it is.
 */

/** How a bet size is bucketed. Coarse on purpose: humans do not measure. */
export type SizeBucket = 'small' | 'medium' | 'large';

/**
 * The bet we are facing, as a fraction of the pot it went into.
 *
 * ONE definition, used both when a size is recorded and when it is looked up
 * again. They were written separately and disagreed: recording divided by
 * `pot - theirBet` while lookup divided by `pot - toCall`, and those differ
 * by whatever we had already put in on that street. The bot could therefore
 * file a read under "large" and later consult "medium" for the same bet —
 * reading a memory it had never written, and folding to a pattern it had not
 * actually seen.
 *
 * `toCall` is the chips we must add, and the pot before their bet is the pot
 * as it stands minus the chips they just added — which is `toCall`, not their
 * whole street commitment. Their earlier chips on this street were already in
 * the pot their bet went into.
 */
export function betFraction(ctx: {
  pot: number; toCall: number;
}): number {
  const potBefore = Math.max(1, ctx.pot - ctx.toCall);
  return ctx.toCall / potBefore;
}

export function bucketOf(fractionOfPot: number): SizeBucket {
  if (fractionOfPot <= 0.45) return 'small';
  if (fractionOfPot <= 0.85) return 'medium';
  return 'large';
}

/** What we have shown down after using a given size on a given street. */
interface SizeMemory {
  /** Showdowns seen after this size. */
  count: number;
  /** Mean strength of the hands shown, 0-1. */
  meanStrength: number;
}

/**
 * Showdowns needed before a size means anything.
 *
 * Six is roughly where a human starts to feel a pattern rather than remember
 * a hand. Set too low the bot invents reads from single showdowns and plays
 * worse than a fixed strategy, which would make it a bad measuring stick in
 * the opposite direction.
 */
export const MIN_SHOWDOWNS_TO_ADAPT = 6;

/**
 * A neutral expectation for how strong a bettor's hand is.
 *
 * Exported because the readability metric in the measurement harness scores
 * every read by its distance from neutral, and had its own copy of this
 * number. Two constants meaning the same thing is how the score would end up
 * disagreeing with the behaviour it is supposed to be measuring.
 */
export const NEUTRAL_STRENGTH = 0.55;

/**
 * How strong the hand they showed was, on whatever board it was shown.
 *
 * `quickStrength` runs the five-card evaluator and throws below three board
 * cards. A showdown can genuinely happen with no board at all — everyone all
 * in before the flop, or a harness recording a hand that ended there — and
 * the bot crashed on it. The fix is not a try/catch: preflop there is a real
 * answer, which is how the two cards rank on their own.
 *
 * `handPercentile` is 0 for the best hand and 1 for the worst, so it is
 * inverted here to match the strength scale used everywhere else. Getting
 * that backwards would teach the bot that we show down aces when we are
 * weakest.
 */
function strengthShown(hole: [Card, Card], board: Card[]): number {
  if (board.length < 3) return 1 - handPercentile(hole[0], hole[1]);
  return quickStrength(hole, board);
}

export interface AdaptiveStats {
  /** What it has concluded, for reporting. */
  reads: { key: string; count: number; meanStrength: number }[];
  showdownsSeen: number;
  handsSeen: number;
}

export class AdaptiveBot implements SimPlayer {
  readonly name: string;
  private base: ScriptedBot;

  /** street|bucket → what we showed down after betting that way. */
  private memory = new Map<string, SizeMemory>();

  /** Sizes the opponent used THIS hand, awaiting a showdown to label them. */
  private pending: string[] = [];

  /** What their preflop re-raises have shown down as. */
  private threeBetShowdowns: SizeMemory = { count: 0, meanStrength: 0 };

  private showdownsSeen = 0;
  private handsSeen = 0;

  constructor(cfg: BotConfig, private heroName: string) {
    this.base = new ScriptedBot(cfg);
    this.name = cfg.name;
  }

  decide(ctx: DecisionContext): SimAction {
    this.observe(ctx);

    const action = ctx.street === 'preflop'
      ? this.adaptPreflop(ctx)
      : this.adaptPostflop(ctx);
    return action;
  }

  /**
   * Watch what they just did, before deciding anything.
   *
   * Reads the opponent's committed chips out of the seat view — the same
   * information a player sees on screen — and records the size as a fraction
   * of the pot it went into.
   */
  private observe(ctx: DecisionContext): void {
    const hero = ctx.seats.find(s => s.name === this.heroName);
    if (!hero) return;

    // What they have in front of them beyond what we have matched is the bet
    // we are facing. Nothing to learn from a check or a call.
    const theirBet = hero.committed;
    if (theirBet <= ctx.myCommitted) return;

    /**
     * A posted blind is not a bet, and counting it as one poisoned everything.
     *
     * Heads-up the button acts first before the flop, so on EVERY hand this
     * bot looked across at a big blind of 100 against its own 50, computed a
     * full-pot "bet", and filed it as pre-flop aggression. That single mistake
     * produced the largest read it held — 601 showdowns in `preflop|large` at
     * a mean strength of 0.47 — and 0.47 is simply the strength of a random
     * hand, because the "bet" was a blind and the hand behind it was whatever
     * had been dealt.
     *
     * It then folded to that phantom read, and the readability score used to
     * price a day's work was mostly measuring who had posted the big blind.
     * A measuring instrument that is wrong in a plausible direction is worse
     * than one that is obviously broken.
     */
    if (ctx.street === 'preflop' && theirBet <= ctx.bigBlind) return;

    const key = `${ctx.street}|${bucketOf(betFraction(ctx))}`;
    if (!this.pending.includes(key)) this.pending.push(key);

    if (ctx.street === 'preflop' && theirBet > ctx.bigBlind * 2.5) {
      if (!this.pending.includes('3bet')) this.pending.push('3bet');
    }
  }

  /** How strong their range has proven at this size, or null if unknown. */
  private strengthAt(street: string, bucket: SizeBucket): number | null {
    const m = this.memory.get(`${street}|${bucket}`);
    if (!m || m.count < MIN_SHOWDOWNS_TO_ADAPT) return null;
    return m.meanStrength;
  }

  private adaptPreflop(ctx: DecisionContext): SimAction {
    const base = this.base.decide(ctx);
    const facingRaise = ctx.toCall > ctx.bigBlind - ctx.myCommitted;
    if (!facingRaise) return base;

    const isThreeBet = ctx.toCall + ctx.myCommitted > ctx.bigBlind * 2.5;
    const read = isThreeBet
      ? (this.threeBetShowdowns.count >= MIN_SHOWDOWNS_TO_ADAPT
          ? this.threeBetShowdowns.meanStrength : null)
      : this.strengthAt('preflop', bucketOf(betFraction(ctx)));
    if (read === null) return base;

    const pct = handPercentile(ctx.holeCards[0], ctx.holeCards[1]);

    /**
     * Their raise has been strong — give it more respect than the base
     * strategy does. This is the behaviour the user actually observed: an
     * opponent who folds to everything once he decides the raise means a
     * real hand.
     */
    if (read > NEUTRAL_STRENGTH + 0.10) {
      const tightened = 0.25 - (read - NEUTRAL_STRENGTH);
      if (pct > Math.max(0.04, tightened) && base.type !== 'fold') {
        return { type: 'fold' };
      }
    }

    /** Their raise has been weak — fight back with more hands. */
    if (read < NEUTRAL_STRENGTH - 0.10 && base.type === 'fold' && pct < 0.55) {
      return ctx.rng() < 0.5
        ? { type: 'raise', to: Math.round(Math.max(ctx.minRaiseTo, (ctx.myCommitted + ctx.toCall) * 2.8)) }
        : { type: 'call' };
    }

    return base;
  }

  private adaptPostflop(ctx: DecisionContext): SimAction {
    const base = this.base.decide(ctx);
    if (ctx.toCall <= 0) return base;

    const read = this.strengthAt(ctx.street, bucketOf(betFraction(ctx)));
    if (read === null) return base;

    const equity = quickStrength(ctx.holeCards, ctx.board);

    /**
     * This size has been showing up strong: fold hands that would otherwise
     * have called. The threshold moves with how strong, so a size that is
     * merely above average costs us a marginal call and one that is always
     * the nuts costs us everything but our own strong hands.
     */
    if (read > NEUTRAL_STRENGTH + 0.10) {
      const needed = 0.45 + (read - NEUTRAL_STRENGTH) * 1.2;
      if (equity < needed && base.type !== 'fold') return { type: 'fold' };
    }

    /**
     * This size has been showing up weak: call wider, and raise the ones
     * that can stand it. Punishing a bluffing size is how a real opponent
     * takes the profit out of an unbalanced strategy.
     */
    if (read < NEUTRAL_STRENGTH - 0.10) {
      if (base.type === 'fold' && equity > 0.30) return { type: 'call' };
      if (equity > 0.55 && ctx.rng() < 0.4) {
        return { type: 'raise', to: Math.round(ctx.minRaiseTo + ctx.pot * 0.5) };
      }
    }

    return base;
  }

  /**
   * The hand is over. Learn only from what was actually shown.
   *
   * Called by the harness. `heroCards` is passed ONLY when the hand reached
   * showdown and the cards were turned face up — the harness is responsible
   * for that, and passing them on a hand that ended in a fold would be the
   * bot cheating.
   */
  onHandComplete(heroCards: [Card, Card] | null, board: Card[]): void {
    this.handsSeen++;

    if (heroCards) {
      this.showdownsSeen++;
      const strength = strengthShown(heroCards, board);
      for (const key of this.pending) {
        if (key === '3bet') {
          this.record(this.threeBetShowdowns, strength);
          continue;
        }
        let m = this.memory.get(key);
        if (!m) {
          m = { count: 0, meanStrength: 0 };
          this.memory.set(key, m);
        }
        this.record(m, strength);
      }
    }

    this.pending = [];
  }

  /** Running mean, so memory stays O(1) per size rather than per hand. */
  private record(m: SizeMemory, strength: number): void {
    m.meanStrength = (m.meanStrength * m.count + strength) / (m.count + 1);
    m.count++;
  }

  /**
   * Deliberately NOT implemented — see the warning below.
   *
   * A defensive `onHandEnd()` that cleared `pending` used to live here, on the
   * reasoning that a harness which forgot to call `onHandComplete` would
   * otherwise carry observations into the next hand. `playHand` calls
   * `onHandEnd` on every player BEFORE it returns, so the clear always ran
   * first and `onHandComplete` arrived to an empty list. The bot recorded
   * nothing, ever, and reported a perfectly healthy 72 showdowns seen while
   * having learned from none of them.
   *
   * The guard against a bug caused a worse one, and it was invisible: the
   * measurement simply came back as noise. `onHandComplete` is the only owner
   * of the per-hand reset, and `adaptive-bot.test.ts` asserts the bot really
   * does form reads, so this cannot regress into silence again.
   */

  stats(): AdaptiveStats {
    const reads = [...this.memory.entries()]
      .filter(([, m]) => m.count >= MIN_SHOWDOWNS_TO_ADAPT)
      .map(([key, m]) => ({ key, count: m.count, meanStrength: m.meanStrength }))
      .sort((a, b) => b.count - a.count);
    if (this.threeBetShowdowns.count >= MIN_SHOWDOWNS_TO_ADAPT) {
      reads.push({
        key: 'preflop 3-bet',
        count: this.threeBetShowdowns.count,
        meanStrength: this.threeBetShowdowns.meanStrength,
      });
    }
    return {
      reads,
      showdownsSeen: this.showdownsSeen,
      handsSeen: this.handsSeen,
    };
  }
}
