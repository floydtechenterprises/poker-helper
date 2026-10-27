import { GameState, PlayerState, ActionType, Card } from '../engine/types';
import { StrategyEngine } from '../engine';
import { LearnedParams, NEUTRAL_PARAMS } from '../engine/learning';
import {
  calculateEquity, estimateOpponentSpec, handPercentile,
} from '../engine/equity/monte-carlo';
import { RangeSpec } from '../engine/equity/range-spec';
import { getPosition, heroHasPosition } from '../engine/position';
import { SimPlayer, SimAction, DecisionContext } from './table';
import { HandFlowTracker } from '../content/hand-flow';
import { LeakTracker } from './diagnostics';

/**
 * Runs the real StrategyEngine inside the simulator.
 *
 * Equity is precomputed here at a lower sample count than the extension
 * uses — the engine honours `precomputedEquity`, so this keeps millions of
 * simulated decisions tractable without changing any decision logic.
 */
export class HeroPlayer implements SimPlayer {
  readonly name: string;
  readonly leaks = new LeakTracker();
  private engine = new StrategyEngine();
  private flow = new HandFlowTracker();
  private bigBlind = 20;

  // Postflop equity is deterministic given cards + opponents + range, so
  // repeated spots across a long run can reuse the result. This is the
  // difference between simulating thousands of hands and millions.
  private equityCache = new Map<string, number>();

  constructor(
    private samples = 300,
    private learned: LearnedParams = NEUTRAL_PARAMS,
    name = 'Hero',
  ) {
    this.name = name;
  }

  onHandEnd(net: number): void {
    this.flow.reset();
    this.leaks.settle(net, this.bigBlind);
  }

  private cachedEquity(
    hole: [Card, Card], board: Card[], opponents: number, range: RangeSpec,
  ): number {
    // Canonical key: card order within hole and board doesn't matter
    const enc = (c: Card) => c.rank * 4 + c.suit;
    const h = [enc(hole[0]), enc(hole[1])].sort((a, b) => a - b).join(',');
    const b = board.map(enc).sort((a, b2) => a - b2).join(',');
    // The cache key must cover the WHOLE spec: two spots with the same
    // starting-hand percentile but different value weights are different
    // questions, and sharing an answer would silently reuse the wrong one.
    const key = `${h}|${b}|${opponents}|${range.percentile.toFixed(2)}`
      + `|${range.valueWeight.toFixed(2)}|${range.minCategory}`;

    const hit = this.equityCache.get(key);
    if (hit !== undefined) return hit;

    const eq = calculateEquity(hole, board, opponents, this.samples, range).equity;
    // Bound memory on very long runs
    if (this.equityCache.size > 400_000) this.equityCache.clear();
    this.equityCache.set(key, eq);
    return eq;
  }

  async decide(ctx: DecisionContext): Promise<SimAction> {
    this.bigBlind = ctx.bigBlind;
    const state = this.toGameState(ctx);

    // Keep hand-flow context in sync so c-bet / barrel logic behaves as it
    // would in a real game
    const otherMaxBet = Math.max(
      0, ...ctx.seats.filter(s => !s.isYou).map(s => s.committed),
    );
    this.flow.update({
      street: ctx.street,
      heroBet: ctx.myCommitted,
      otherMaxBet,
      bigBlind: ctx.bigBlind,
    });
    state.heroIsPreflopAggressor = this.flow.isHeroPreflopAggressor();
    state.flopWasChecked = this.flow.flopWasChecked();
    state.heroBetFlop = this.flow.didHeroBetFlop();
    state.heroBetTurn = this.flow.didHeroBetTurn();

    const opponents = Math.max(1, ctx.numActive - 1);
    /**
     * Pass the opponent read, exactly as the extension does.
     *
     * This called `estimateOpponentSpec(state)` with no read at all, so the
     * simulator narrowed every opponent's range to the generic estimate and
     * silently measured a WEAKER engine than the one that ships — profiles
     * were loaded, held, and never consulted. Any profile-driven change
     * therefore scored as exactly zero improvement, which is indistinguishable
     * from the change not working.
     */
    // No profile to narrow the simulated range with, so it stays unweighted.
    // The hero in the simulator therefore prices its equity exactly as the
    // shipped engine now does, which is the whole point of measuring here.
    const range = estimateOpponentSpec(state, undefined);

    if (ctx.street === 'preflop') {
      // The preflop advisor decides from range charts — equity is only used
      // for display, never for the decision. Substituting a cheap estimate
      // removes the single most frequent Monte Carlo call in the whole run
      // without changing a single action.
      const pct = handPercentile(ctx.holeCards[0], ctx.holeCards[1]);
      state.precomputedEquity = Math.max(0.1, (1 - pct) * 0.9 / Math.sqrt(opponents));
    } else {
      state.precomputedEquity = this.cachedEquity(
        ctx.holeCards, ctx.board, opponents, range,
      );
    }

    const advice = await this.engine.evaluate(state, this.learned);

    this.leaks.record({
      street: ctx.street,
      action: advice.action,
      handClass: advice.handStrength.relative,
      // Same acting-order rule the engine uses; the label is preflop-only
      inPosition: heroHasPosition(state),
      facingBet: ctx.toCall > 0,
      multiway: ctx.numActive > 2,
      wetBoard: advice.boardTexture.wetness >= 5,
      equity: state.precomputedEquity,
      committedSoFar: ctx.seats[ctx.seatIndex].totalIn,
    });

    return this.toSimAction(advice.action, advice.amount, ctx);
  }

  private toGameState(ctx: DecisionContext): GameState {
    const players: PlayerState[] = ctx.seats.map((s, idx) => ({
      name: s.name,
      seatIndex: idx,
      stack: s.stack,
      currentBet: s.committed,
      isActive: !s.folded,
      isYou: s.isYou,
    }));

    const activeSeats = players.filter(p => p.isActive).map(p => p.seatIndex);
    const position = getPosition(ctx.seatIndex, ctx.buttonIndex, activeSeats);

    const available: ActionType[] = [];
    if (ctx.toCall > 0) {
      available.push('fold', 'call');
      if (ctx.myStack > ctx.toCall) available.push('raise');
    } else {
      available.push('check');
      if (ctx.myStack > 0) available.push('bet');
    }

    return {
      holeCards: ctx.holeCards,
      communityCards: ctx.board,
      street: ctx.street,
      pot: ctx.pot,
      yourStack: ctx.myStack,
      yourCurrentBet: ctx.myCommitted,
      costToCall: ctx.toCall,
      minRaise: ctx.minRaiseTo,
      bigBlind: ctx.bigBlind,
      smallBlind: ctx.bigBlind / 2,
      players,
      activePlayers: ctx.numActive,
      position,
      dealerSeatIndex: ctx.buttonIndex,
      availableActions: available,
    };
  }

  private toSimAction(
    action: string, amount: number | undefined, ctx: DecisionContext,
  ): SimAction {
    switch (action) {
      case 'fold':
        return ctx.toCall > 0 ? { type: 'fold' } : { type: 'check' };
      case 'check':
        return ctx.toCall > 0 ? { type: 'call' } : { type: 'check' };
      case 'call':
        return ctx.toCall > 0 ? { type: 'call' } : { type: 'check' };
      case 'bet':
      case 'raise': {
        const to = Math.max(ctx.minRaiseTo, Math.round(amount ?? ctx.pot * 0.5));
        return { type: 'raise', to };
      }
      default:
        return ctx.toCall > 0 ? { type: 'fold' } : { type: 'check' };
    }
  }
}
