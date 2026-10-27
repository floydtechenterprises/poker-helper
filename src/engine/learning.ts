import { ActionType, Street, Card } from './types';

export interface DecisionRecord {
  id?: number;
  timestamp: number;
  sessionId: string;
  street: Street;
  holeCards: [Card, Card];
  communityCards: Card[];
  recommended: ActionType;
  recommendedAmount?: number;
  confidence: number;
  equity: number;
  potSize: number;
  stackSize: number;
  outcome: 'win' | 'loss' | 'unknown';
  /**
   * Tracked name of the opponent this decision was made against.
   *
   * Optional: absent on every record written before this existed, and on
   * decisions where nobody at the table is being tracked. Those records still
   * count toward the pooled history — they just cannot be attributed, which
   * is the honest state rather than a default that would file them all under
   * whoever happens to be sitting there now.
   */
  opponent?: string;
  profitLoss: number;
  activePlayers: number;
  position: string;
  boardWetness: number;
  wasBluff: boolean;
  /**
   * The equity a call needed, in percent — the price the decision was made
   * on. Absent on records written before it existed; those keep the old
   * fixed bar rather than being re-priced on a guess.
   */
  priceNeeded?: number;
  /** Big blind when the decision was made, to read chip results in blinds. */
  bigBlind?: number;
  /**
   * Players DEALT IN to the hand — the table size — as opposed to
   * `activePlayers`, which is how many were still in when we decided.
   */
  tableSize?: number;
  /** When the hand this decision belongs to began: its identity for grouping. */
  handStart?: number;
}

export interface LearningStats {
  totalDecisions: number;
  wins: number;
  losses: number;
  /** Distinct hands graded — a hand's several decisions counted once (L15). */
  resolvedHandCount: number;
  /** Graded hands in which we bluffed, however many barrels (L13). */
  bluffHands: number;
  winRate: number;
  avgConfidenceOnWin: number;
  avgConfidenceOnLoss: number;
  bluffSuccessRate: number;
  bluffSuccessByStreet: Record<Street, { attempts: number; wins: number }>;
  profitByAction: Record<ActionType, number>;
  profitByPosition: Record<string, number>;
  profitByStreet: Record<Street, number>;
  // Mistake tracking: losses where we had low equity when the money went in
  // are real mistakes; losses with high equity are coolers, not our fault
  badCallLosses: number;      // called with equity below what pot odds required
  goodCallsTotal: number;
  thinValueProfit: number;    // profit on bets/raises with 45-60% equity
  aggressionProfit: number;   // profit on all bets/raises
  passiveProfit: number;      // profit on checks/calls
  /**
   * The same results in big blinds, from records that know their blind (L6).
   * The rules read these; the chip totals above are for display.
   */
  thinValueBB: number;
  aggressionBB: number;
  passiveBB: number;
  profitByPositionBB: Record<string, number>;
  /** Graded decisions with a recorded big blind — the denominator for the above. */
  resolvedWithBlind: number;
  /**
   * How many of these decisions were heads-up.
   *
   * Position leaks are only leaks when there are positions to leak from.
   * Heads-up every hand is played from a blind, so "losing from the SB" is
   * arithmetically guaranteed the moment the session is down — it is not a
   * positional read, it is the whole session wearing a position label.
   */
  headsUpDecisions: number;
}

export interface StrategyAdjustment {
  type: string;
  description: string;
  weight: number; // -1 to 1, negative = do less, positive = do more
}

/**
 * Learned parameters that directly re-tune the strategy engine's decision
 * thresholds — not just confidence display. All default to 1.0 (neutral).
 */
export interface LearnedParams {
  bluffScale: number;       // <1 = bluff lines need to be stronger to fire
  riverBluffScale: number;  // separate dial for river bluffs specifically
  callMargin: number;       // >1 = demand more equity above the price to call
  blindTightness: number;   // >1 = fold marginal hands from SB/BB
  thinValueScale: number;   // <1 = skip thin value bets
}

// Minimum sample sizes before the engine will draw a conclusion. Below
// these, results are noise and acting on them makes advice worse.
export const MIN_DECISIONS = 25;
export const MIN_BLUFFS = 10;
export const MIN_CALLS = 10;
export const MIN_RIVER_BLUFFS = 5;

/**
 * The blind-tightness dial when the leak is fully concluded. Blended toward
 * 1 by the opponent weight, and applied in proportion to how far it has moved
 * (see the preflop advisor), not switched on by any value above 1 (L11).
 */
export const BLIND_TIGHTNESS_FULL = 1.2;

/**
 * Profit thresholds, in big blinds (L6).
 *
 * These were chips — ±8 a decision, -5 on thin value, -100 from a blind — and
 * a hyper-turbo's blinds rise twelvefold and more, so the same play crossed
 * them late in a match and not early: 8 chips is 0.4 bb at 10/20 and 0.03 bb
 * at 150/300. Converted at 10/20, the scale they were written for.
 */
export const AGGRESSION_BB_PER_DECISION = 0.4;
export const THIN_VALUE_BB_PER_DECISION = 0.25;
export const BLIND_LEAK_BB = 5;

export interface LearningSnapshot {
  totalDecisions: number;
  resolvedHands: number;
  winRate: number;
  bluffAttempts: number;
  bluffSuccessRate: number;
  bluffByStreet: { flop: number | null; turn: number | null; river: number | null };
  /**
   * How many bluffs back each of those rates.
   *
   * A rate without its sample is not a read. "Turn 36%" prompted a question
   * about whether turn bluffs were leaking, and nothing on screen could say
   * whether that was thirty attempts or three — so the number could not be
   * acted on either way.
   */
  bluffAttemptsByStreet: { flop: number; turn: number; river: number };
  callsTracked: number;
  badCallRate: number;
  aggressionProfit: number;
  passiveProfit: number;
  adjustments: StrategyAdjustment[];
  params: LearnedParams;
  thresholds: {
    decisions: { have: number; need: number };
    bluffs: { have: number; need: number };
    calls: { have: number; need: number };
  };
  active: boolean;
  /**
   * How much of the current strategy comes from THIS opponent's history.
   *
   * Surfaced rather than left internal. A learning layer that silently
   * switches which history it is reading is exactly the kind of thing that
   * has already cost days here — the read existed, was correct, and nothing
   * on screen said whether it was running.
   */
  vsOpponent?: {
    name: string;
    decisions: number;
    /** 0 = pooled history only, 1 = entirely this opponent. */
    weight: number;
    need: number;
  } | null;
}

export const NEUTRAL_PARAMS: LearnedParams = {
  bluffScale: 1,
  riverBluffScale: 1,
  callMargin: 1,
  blindTightness: 1,
  thinValueScale: 1,
};

export interface SessionState {
  sessionId: string;
  gameUrl: string;
  startingBalance: number;
  currentBalance: number;
  startTime: number;
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  biggestWin: number;
  biggestLoss: number;
  playerMappings: Record<string, string>; // tracked name -> in-game username
  decisions: DecisionRecord[];
}

const DB_STORE = 'decision-log';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Longest gap between two decisions of the same hand. */
const HAND_GAP_MS = 3 * 60 * 1000;

/**
 * Group decisions into the hands they were made in.
 *
 * By `handStart` where the record has one. Older records carry no hand id:
 * for those, a hand's decisions share the session and the exact hole cards
 * and come minutes apart at most, and the same two cards dealt again later
 * in a session (in 200 hands that happens about 15 times) start a new group
 * because of the gap.
 */
export function groupByHand(records: DecisionRecord[]): DecisionRecord[][] {
  const card = (c: Card) => c.rank * 4 + c.suit;
  const groups: DecisionRecord[][] = [];
  const open = new Map<string, DecisionRecord[]>();
  for (const r of [...records].sort((a, b) => a.timestamp - b.timestamp)) {
    if (r.handStart !== undefined) {
      const key = `${r.sessionId}|hand ${r.handStart}`;
      const group = open.get(key);
      if (group) group.push(r);
      else { const fresh = [r]; groups.push(fresh); open.set(key, fresh); }
      continue;
    }
    const key = `${r.sessionId}|${(r.holeCards ?? []).map(card).sort((a, b) => a - b).join('-')}`;
    const group = open.get(key);
    if (group && r.timestamp - group[group.length - 1].timestamp <= HAND_GAP_MS) {
      group.push(r);
    } else {
      const fresh = [r];
      groups.push(fresh);
      open.set(key, fresh);
    }
  }
  return groups;
}

/**
 * Pure core of outcome stamping: pick only the finished hand's unresolved
 * decisions (timestamp >= handStartTs), label them all with the outcome,
 * and put the chip result on the final decision only.
 */
export function stampHandOutcome(
  records: DecisionRecord[],
  handStartTs: number,
  outcome: 'win' | 'loss',
  profitLoss: number,
  /**
   * When the hand finished. Required, not defaulted.
   *
   * With only a start bound, every unresolved decision from that moment on
   * belonged to "this hand" — including decisions from the NEXT one. The log
   * path grades a hand a hand late (its log modal lags the table), so it
   * stamped the current hand's decisions with the previous hand's result, and
   * then the table grader found nothing left to grade (L1, L2).
   */
  handEndTs: number,
): DecisionRecord[] {
  const handRecords = records
    .filter(r => r.outcome === 'unknown' && r.timestamp >= handStartTs && r.timestamp < handEndTs)
    .sort((a, b) => a.timestamp - b.timestamp);

  /**
   * Shared across the hand's decisions, not handed to the last one.
   *
   * Giving the whole result to the final decision credited a raise, a bet
   * and a winning call entirely to the CALL: aggression earned nothing in the
   * hands it won, and the aggression-balance read — which compares profit on
   * bets and raises against checks and calls — was measuring which action
   * tends to come last (L5). An even split keeps the hand's total exact
   * (the last share absorbs any rounding) without guessing at more.
   */
  const share = handRecords.length > 0 ? profitLoss / handRecords.length : 0;
  for (let i = 0; i < handRecords.length; i++) {
    handRecords[i].outcome = outcome;
    handRecords[i].profitLoss = i === handRecords.length - 1
      ? profitLoss - share * (handRecords.length - 1)
      : share;
  }
  return handRecords;
}

/**
 * Decisions against one opponent before their history fully replaces the
 * pooled one.
 *
 * Below `MIN_DECISIONS` the opponent-specific numbers are noise and the
 * pooled history is the better guess. Between there and this, the two are
 * blended in proportion, so the parameters slide across instead of jumping
 * the moment a counter ticks past a threshold — a discontinuity that would
 * show up as the advice changing for no reason a player could see.
 */
export const FULL_OPPONENT_WEIGHT = MIN_DECISIONS * 2;

/**
 * How far back one opponent's decisions still describe him. A month keeps a
 * month of regular play against the same player, and lets someone met again
 * after a long gap start from the pooled history instead of an old read.
 */
export const OPPONENT_HISTORY_DAYS = 30;

/**
 * What makes two evaluations the same decision.
 *
 * The hand, the spot within it, and what we were told to do. Equity and
 * confidence are deliberately absent: equity comes from Monte Carlo and
 * moves by a fraction of a percent between runs on identical input, so
 * keying on it would make every tick look new and defeat the whole thing.
 *
 * `potSize` is included because the opponent putting chips in genuinely
 * makes it a different decision, even on the same street with the same
 * board and the same answer.
 */
export function decisionIdentity(r: DecisionRecord): string {
  const cards = (cs: Card[] | undefined) =>
    (cs ?? []).map(c => `${c.rank}-${c.suit}`).join(',');
  return [
    r.sessionId,
    r.handStart ?? 'no-hand',
    r.street,
    cards(r.holeCards),
    cards(r.communityCards),
    r.recommended,
    r.recommendedAmount ?? '',
    r.potSize,
  ].join('|');
}

export class LearningEngine {
  private stats: LearningStats | null = null;
  /** The last decision actually written — see `recordDecision`. */
  private lastRecordedIdentity: string | null = null;
  /**
   * The same statistics restricted to the opponent in front of us.
   *
   * The pooled history mixes everyone. Heads-up that is actively misleading:
   * "river bluffs are getting called" learned against a station is the exact
   * opposite of the truth against a rock, and applying it to the rock is a
   * leak manufactured out of someone else's tendencies. Across a week of
   * different opponents — nine of them, none alike — the pooled figure
   * describes nobody.
   */
  private opponentStats: LearningStats | null = null;
  private opponentName: string | null = null;

  /**
   * @param opponent tracked name of the player we are up against, when known.
   *   Recomputes their slice of the history alongside the pooled one.
   */
  async loadStats(db: IDBDatabase, opponent?: string | null): Promise<LearningStats> {
    const records = await this.getAllRecords(db);
    this.stats = this.computeStats(records);

    this.opponentName = opponent ?? null;
    /**
     * His history, from the last OPPONENT_HISTORY_DAYS.
     *
     * computeStats keeps the most recent 300 decisions, which is recent for
     * the pooled history and not for one opponent: against someone you meet
     * occasionally, 300 decisions reach back months, and those came back at
     * full weight as a read on how he plays now (L8).
     */
    const since = Date.now() - OPPONENT_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    this.opponentStats = opponent
      ? this.computeStats(records.filter(r => r.opponent === opponent && r.timestamp >= since))
      : null;
    return this.stats;
  }

  /** How much weight the opponent-specific history currently carries, 0-1. */
  opponentWeight(): number {
    const n = this.opponentStats?.totalDecisions ?? 0;
    if (n < MIN_DECISIONS) return 0;
    // From 0 at MIN_DECISIONS to 1 at FULL_OPPONENT_WEIGHT. This was
    // n / FULL, which made the 25th decision jump the weight from 0 to 0.5 —
    // the discontinuity the comment on FULL_OPPONENT_WEIGHT exists to avoid (L7).
    return Math.min(1, (n - MIN_DECISIONS) / (FULL_OPPONENT_WEIGHT - MIN_DECISIONS));
  }

  /**
   * Store a decision, unless it is the one already stored.
   *
   * The advisor re-evaluates on every DOM tick and called this each time,
   * so the log counted ticks, not decisions. On the 21 October backup that
   * was 20873 rows for 1822 decisions — 11.5x — with one hand that sat for
   * 450 seconds contributing 2666 of them: one pair of hole cards, one
   * board, one unchanged piece of advice.
   *
   * The cost is not storage. `computeStats` slices the last 300 ROWS before
   * grouping them into hands, so the window meant to hold recent play held
   * four hands, and three single hands were each long enough to fill it
   * alone. Learning was adapting to almost nothing while the log looked
   * full.
   *
   * Returns whether anything was written, so the caller can keep its own
   * copy in step rather than tracking this separately.
   */
  async recordDecision(db: IDBDatabase, record: DecisionRecord): Promise<boolean> {
    const identity = decisionIdentity(record);
    if (identity === this.lastRecordedIdentity) return false;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Only after the write succeeds: a failed write must not make the next
    // identical attempt look like a duplicate and get skipped too.
    this.lastRecordedIdentity = identity;
    return true;
  }

  /**
   * Stamp the finished hand's outcome onto ONLY that hand's decisions
   * (timestamp >= handStartTs). The chip result is assigned to the final
   * decision of the hand so profit isn't double-counted across records;
   * earlier decisions still get the win/loss label.
   */
  async updateOutcome(
    db: IDBDatabase,
    sessionId: string,
    handStartTs: number,
    outcome: 'win' | 'loss',
    profitLoss: number,
    /** When the hand finished — see stampHandOutcome. */
    handEndTs: number,
  ): Promise<void> {
    const records = await this.getSessionRecords(db, sessionId);
    const stamped = stampHandOutcome(records, handStartTs, outcome, profitLoss, handEndTs);
    if (stamped.length === 0) return;

    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    for (const rec of stamped) store.put(rec);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Adjustments implied by one set of statistics.
   *
   * Split out from `getAdjustments` so the same rules can be run over the
   * pooled history and over one opponent's history without a second copy of
   * them — the copy is how two sets of thresholds drift apart.
   */
  private adjustmentsFor(stats: LearningStats | null): StrategyAdjustment[] {
    // Need a real sample before drawing conclusions — small samples are noise
    if (!stats || stats.totalDecisions < MIN_DECISIONS) return [];
    const s = stats;

    const adjustments: StrategyAdjustment[] = [];

    // --- Bluffing ---
    const bluffAttempts = s.bluffHands; // hands, not barrels (L13)

    if (bluffAttempts >= MIN_BLUFFS) {
      if (s.bluffSuccessRate < 0.35) {
        adjustments.push({
          type: 'bluff-frequency',
          description: 'Bluffs are failing too often — tighten up bluffing',
          weight: -0.3,
        });
      } else if (s.bluffSuccessRate > 0.6) {
        adjustments.push({
          type: 'bluff-frequency',
          description: 'Bluffs are working — opponents over-fold, keep pressuring',
          weight: 0.15,
        });
      }

      // Per-street bluff leaks: river bluffs failing while flop bluffs work
      const river = s.bluffSuccessByStreet.river;
      if (river.attempts >= MIN_RIVER_BLUFFS && river.wins / river.attempts < 0.3) {
        adjustments.push({
          type: 'river-bluff-frequency',
          description: 'River bluffs getting called — opponents don\'t fold rivers here',
          weight: -0.35,
        });
      }
    }

    // --- Calling discipline ---
    // Bad calls = calls that lost where our equity was below the price.
    if (s.goodCallsTotal >= MIN_CALLS) {
      const badCallRate = s.badCallLosses / s.goodCallsTotal;
      if (badCallRate > 0.4) {
        adjustments.push({
          type: 'fold-threshold',
          description: 'Too many losing calls without the right price — fold marginal spots',
          weight: -0.25,
        });
      }
    }

    // --- Aggression balance ---
    //
    // Per RESOLVED decision. Profit only ever comes from graded decisions, but
    // this divided by all of them — chopped pots, hands never stamped — so
    // every ungraded decision diluted the rate toward zero and the ±8
    // thresholds grew harder to reach the more data went missing (L3).
    //
    // In big blinds, over the graded decisions that recorded one (L6). Records
    // from before the blind was recorded are left out, not guessed at.
    const decisions = Math.max(1, s.resolvedWithBlind);
    if (s.aggressionBB / decisions < -AGGRESSION_BB_PER_DECISION && s.passiveBB / decisions > 0) {
      adjustments.push({
        type: 'raise-frequency',
        description: 'Aggression is bleeding chips at this table — value bet stronger, bluff less',
        weight: -0.2,
      });
    } else if (s.aggressionBB / decisions > AGGRESSION_BB_PER_DECISION) {
      adjustments.push({
        type: 'raise-frequency',
        description: 'Aggression is printing — keep betting and raising',
        weight: 0.15,
      });
    }

    if (s.thinValueBB / decisions < -THIN_VALUE_BB_PER_DECISION) {
      adjustments.push({
        type: 'thin-value',
        description: 'Thin value bets losing — this table doesn\'t pay off marginal bets',
        weight: -0.2,
      });
    }

    /**
     * Position leaks — only where position means something.
     *
     * Heads-up there are exactly two seats and both are blinds, so every hand
     * ever played is an SB or BB hand. A losing stretch therefore always
     * produces "losing from the blinds", the engine tightens every marginal
     * holding, and it undoes the wide heads-up ranges that are correct there.
     * A conclusion that a format guarantees is not a read.
     */
    const mostlyHeadsUp = s.headsUpDecisions > s.totalDecisions * 0.5;
    for (const [pos, profit] of Object.entries(s.profitByPositionBB)) {
      if (mostlyHeadsUp) break;
      if (profit < -BLIND_LEAK_BB && (pos === 'SB' || pos === 'BB')) {
        adjustments.push({
          type: `${pos}-tightness`,
          description: `Losing from ${pos} — tighten range from the blinds`,
          weight: -0.2,
        });
      }
    }

    return adjustments;
  }

  /**
   * The adjustments in force right now.
   *
   * Prefers what we have learned against THIS opponent once that is a real
   * sample, and falls back to the pooled history otherwise. Descriptions from
   * the opponent-specific set are tagged with the name, so the reasoning line
   * says whose behaviour produced the change rather than presenting a read
   * about one player as a fact about poker.
   */
  getAdjustments(): StrategyAdjustment[] {
    const opp = this.opponentStats;
    /**
     * Report the history that is actually steering.
     *
     * This switched to the opponent's read alone at MIN_DECISIONS, while the
     * thresholds (getLearnedParams) blend by weight. For a stretch of
     * decisions the panel and the confidence showed one opinion and the
     * thresholds acted on another — "bluffs are failing" printed beside a
     * bluff that still fired (L12). Now his read is reported once it carries
     * at least half the blend.
     */
    if (opp && this.opponentWeight() >= 0.5) {
      const who = this.opponentName;
      return this.adjustmentsFor(opp).map(a => ({
        ...a,
        description: who ? `vs ${who}: ${a.description}` : a.description,
      }));
    }
    return this.adjustmentsFor(this.stats);
  }

  /**
   * Everything the UI needs to show what the system has learned and how
   * close it is to drawing its next conclusion.
   */
  getSnapshot(): LearningSnapshot {
    const s = this.stats;
    if (!s) {
      return {
        totalDecisions: 0, resolvedHands: 0, winRate: 0,
        bluffAttempts: 0, bluffSuccessRate: 0,
        bluffByStreet: { flop: null, turn: null, river: null },
        bluffAttemptsByStreet: { flop: 0, turn: 0, river: 0 },
        callsTracked: 0, badCallRate: 0,
        aggressionProfit: 0, passiveProfit: 0,
        adjustments: [], params: { ...NEUTRAL_PARAMS },
        thresholds: {
          decisions: { have: 0, need: MIN_DECISIONS },
          bluffs: { have: 0, need: MIN_BLUFFS },
          calls: { have: 0, need: MIN_CALLS },
        },
        active: false,
      };
    }

    // Bluffed hands, the unit the bluff rule counts in (L13)
    const bluffAttempts = s.bluffHands;
    const rate = (b: { attempts: number; wins: number }) =>
      b.attempts > 0 ? b.wins / b.attempts : null;

    return {
      totalDecisions: s.totalDecisions,
      // Hands, not decisions: this was wins + losses, 2-3x the hands (L15)
      resolvedHands: s.resolvedHandCount,
      winRate: s.winRate,
      bluffAttempts,
      bluffSuccessRate: s.bluffSuccessRate,
      bluffByStreet: {
        flop: rate(s.bluffSuccessByStreet.flop),
        turn: rate(s.bluffSuccessByStreet.turn),
        river: rate(s.bluffSuccessByStreet.river),
      },
      bluffAttemptsByStreet: {
        flop: s.bluffSuccessByStreet.flop.attempts,
        turn: s.bluffSuccessByStreet.turn.attempts,
        river: s.bluffSuccessByStreet.river.attempts,
      },
      callsTracked: s.goodCallsTotal,
      badCallRate: s.goodCallsTotal > 0 ? s.badCallLosses / s.goodCallsTotal : 0,
      aggressionProfit: s.aggressionProfit,
      passiveProfit: s.passiveProfit,
      adjustments: this.getAdjustments(),
      params: this.getLearnedParams(),
      thresholds: {
        decisions: { have: s.totalDecisions, need: MIN_DECISIONS },
        bluffs: { have: bluffAttempts, need: MIN_BLUFFS },
        calls: { have: s.goodCallsTotal, need: MIN_CALLS },
      },
      active: s.totalDecisions >= MIN_DECISIONS,
      vsOpponent: this.opponentName
        ? {
          name: this.opponentName,
          decisions: this.opponentStats?.totalDecisions ?? 0,
          weight: this.opponentWeight(),
          need: MIN_DECISIONS,
        }
        : null,
    };
  }

  /**
   * Convert accumulated adjustments into hard strategy parameters.
   * These change what the engine DOES, not just how sure it sounds.
   */
  /**
   * The parameters in force: this opponent's lessons, faded in over the
   * pooled ones as their sample grows.
   *
   * Blended numerically rather than by choosing one set, because both are
   * partly right. Some leaks are ours and generalise — calling too wide is
   * calling too wide against anyone. Others are purely about the person
   * across the table, and those must not follow us to the next one.
   */
  getLearnedParams(): LearnedParams {
    const w = this.opponentWeight();
    if (w <= 0) return this.paramsFrom(this.adjustmentsFor(this.stats));

    const pooled = this.paramsFrom(this.adjustmentsFor(this.stats));
    const versus = this.paramsFrom(this.adjustmentsFor(this.opponentStats));
    const mix = (a: number, b: number) => a * (1 - w) + b * w;
    return {
      bluffScale: mix(pooled.bluffScale, versus.bluffScale),
      riverBluffScale: mix(pooled.riverBluffScale, versus.riverBluffScale),
      callMargin: mix(pooled.callMargin, versus.callMargin),
      blindTightness: mix(pooled.blindTightness, versus.blindTightness),
      thinValueScale: mix(pooled.thinValueScale, versus.thinValueScale),
    };
  }

  private paramsFrom(adjustments: StrategyAdjustment[]): LearnedParams {
    const params: LearnedParams = { ...NEUTRAL_PARAMS };
    for (const adj of adjustments) {
      switch (adj.type) {
        case 'bluff-frequency':
          params.bluffScale = clamp(1 + adj.weight, 0.6, 1.3);
          break;
        case 'river-bluff-frequency':
          params.riverBluffScale = clamp(1 + adj.weight, 0.5, 1.3);
          break;
        case 'fold-threshold':
          // weight -0.25 → demand 15% more equity than the raw price
          params.callMargin = clamp(1 - adj.weight * 0.6, 1, 1.3);
          break;
        case 'thin-value':
          params.thinValueScale = clamp(1 + adj.weight, 0.6, 1.2);
          break;
        case 'SB-tightness':
        case 'BB-tightness':
          params.blindTightness = BLIND_TIGHTNESS_FULL;
          break;
      }
    }
    return params;
  }

  applyAdjustmentToConfidence(
    baseConfidence: number,
    action: ActionType,
    isBluff: boolean,
    position: string,
    street?: Street,
  ): number {
    if (!this.stats) return baseConfidence;

    const adjustments = this.getAdjustments();
    let modifier = 0;

    for (const adj of adjustments) {
      if (adj.type === 'bluff-frequency' && isBluff && (action === 'bet' || action === 'raise')) {
        modifier += adj.weight * 20;
      }
      if (adj.type === 'river-bluff-frequency' && isBluff && street === 'river'
          && (action === 'bet' || action === 'raise')) {
        modifier += adj.weight * 25;
      }
      if (adj.type === 'fold-threshold' && action === 'call' && baseConfidence < 55) {
        modifier += adj.weight * 15;
      }
      if (adj.type === 'thin-value' && !isBluff && (action === 'bet' || action === 'raise')
          && baseConfidence < 65) {
        modifier += adj.weight * 15;
      }
      if (adj.type === `${action}-frequency`) {
        modifier += adj.weight * 10;
      }
      if (adj.type === `${position}-tightness` && (action === 'call' || action === 'raise')) {
        modifier += adj.weight * 10;
      }
    }

    return Math.max(5, Math.min(99, Math.round(baseConfidence + modifier)));
  }

  private computeStats(allRecords: DecisionRecord[]): LearningStats {
    // Weight recent play: only the last 300 decisions shape strategy, so the
    // system adapts to how you and your opponents play NOW, not months ago
    const records = allRecords
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-300);

    const stats: LearningStats = {
      totalDecisions: records.length,
      wins: 0,
      losses: 0,
      resolvedHandCount: 0,
      bluffHands: 0,
      winRate: 0,
      avgConfidenceOnWin: 0,
      avgConfidenceOnLoss: 0,
      bluffSuccessRate: 0,
      bluffSuccessByStreet: {
        preflop: { attempts: 0, wins: 0 },
        flop: { attempts: 0, wins: 0 },
        turn: { attempts: 0, wins: 0 },
        river: { attempts: 0, wins: 0 },
      },
      profitByAction: { fold: 0, check: 0, call: 0, bet: 0, raise: 0 },
      profitByPosition: {},
      profitByStreet: { preflop: 0, flop: 0, turn: 0, river: 0 },
      badCallLosses: 0,
      goodCallsTotal: 0,
      thinValueProfit: 0,
      aggressionProfit: 0,
      passiveProfit: 0,
      thinValueBB: 0,
      aggressionBB: 0,
      passiveBB: 0,
      profitByPositionBB: {},
      resolvedWithBlind: 0,
      headsUpDecisions: 0,
    };

    let winConfSum = 0, lossConfSum = 0;

    for (const r of records) {
      // By table size where recorded. Players still in the hand is two for most
      // decisions at any table once the flop comes, so a 6-max history read as
      // "mostly heads-up" and blind tightness never engaged (L9). Older records
      // have only activePlayers.
      if ((r.tableSize ?? r.activePlayers) <= 2) stats.headsUpDecisions++;
      if (r.outcome === 'win') {
        stats.wins++;
        winConfSum += r.confidence;
      } else if (r.outcome === 'loss') {
        stats.losses++;
        lossConfSum += r.confidence;
      }

      stats.profitByAction[r.recommended] = (stats.profitByAction[r.recommended] || 0) + r.profitLoss;
      stats.profitByPosition[r.position] = (stats.profitByPosition[r.position] || 0) + r.profitLoss;
      stats.profitByStreet[r.street] = (stats.profitByStreet[r.street] || 0) + r.profitLoss;

      // Results in big blinds, where the record knows its blind (L6)
      const bb = r.bigBlind && r.bigBlind > 0 ? r.profitLoss / r.bigBlind : null;
      if (bb !== null) {
        if (r.outcome === 'win' || r.outcome === 'loss') stats.resolvedWithBlind++;
        stats.profitByPositionBB[r.position] = (stats.profitByPositionBB[r.position] || 0) + bb;
      }

      /**
       * Only RESOLVED bluffs count.
       *
       * An unresolved decision can never be a win, but it was still counted
       * as an attempt — so every hand still in flight, or whose result was
       * never stamped, dragged the success rate down. The engine then
       * concludes "bluffs are failing too often" and tightens by 0.3 on
       * evidence that is really just missing data.
       *
       * The same reasoning applies to calls below. A denominator that can
       * grow without the numerator ever being able to is not a rate.
       */
      const resolved = r.outcome === 'win' || r.outcome === 'loss';

      // Per street, per decision: each street's bluff is its own choice.
      // The overall rate is per HAND — see below.
      if (resolved && r.wasBluff && (r.recommended === 'bet' || r.recommended === 'raise')) {
        stats.bluffSuccessByStreet[r.street].attempts++;
        if (r.outcome === 'win') {
          stats.bluffSuccessByStreet[r.street].wins++;
        }
      }

      // Calling discipline: a losing call with low equity was a real mistake;
      // a losing call with high equity was a cooler — don't learn from coolers
      /**
       * Equity of exactly 0 means UNMEASURED, not "no chance".
       *
       * No real holding has zero equity, so a recorded 0 is always a missing
       * measurement — and counting it as a bad call would say the opposite.
       * Defensive rather than a fix for an observed failure: every current
       * path does record equity.
       */
      if (resolved && r.recommended === 'call' && r.equity > 0) {
        stats.goodCallsTotal++;
        /**
         * A bad call is one made without the price, not one below 35%.
         *
         * Against a fixed bar, a correct call at 30% equity getting 4:1 that
         * lost counted as a mistake, while a call at 40% needing 50% did not.
         * The dial this feeds (callMargin) then learned to fold calls that
         * were right, and never learned from the ones that were wrong (L4).
         */
        const bar = r.priceNeeded ?? 35;
        if (r.outcome === 'loss' && r.equity < bar) {
          stats.badCallLosses++;
        }
      }

      // Aggression accounting
      if (r.recommended === 'bet' || r.recommended === 'raise') {
        stats.aggressionProfit += r.profitLoss;
        if (bb !== null) stats.aggressionBB += bb;
        if (!r.wasBluff && r.equity >= 45 && r.equity <= 60) {
          stats.thinValueProfit += r.profitLoss;
          if (bb !== null) stats.thinValueBB += bb;
        }
      } else if (r.recommended === 'call' || r.recommended === 'check') {
        stats.passiveProfit += r.profitLoss;
        if (bb !== null) stats.passiveBB += bb;
      }
    }

    const decided = stats.wins + stats.losses;
    stats.winRate = decided > 0 ? stats.wins / decided : 0;
    stats.avgConfidenceOnWin = stats.wins > 0 ? winConfSum / stats.wins : 0;
    stats.avgConfidenceOnLoss = stats.losses > 0 ? lossConfSum / stats.losses : 0;
    /**
     * Hands, not decisions.
     *
     * A flop-turn-river bluff is one bluff that won or lost once, but counted
     * per decision it was three — so four bad hands cleared the ten-bluff
     * minimum and shut bluffing off (L13), and "hands graded" was really
     * decisions graded, two to three times too many (L15).
     */
    const hands = groupByHand(records.filter(r => r.outcome === 'win' || r.outcome === 'loss'));
    stats.resolvedHandCount = hands.length;
    const bluffed = hands.filter(h => h.some(
      r => r.wasBluff && (r.recommended === 'bet' || r.recommended === 'raise'),
    ));
    stats.bluffHands = bluffed.length;
    // 0.5 when nothing has resolved is a placeholder, not a measurement —
    // callers check bluffHands before showing it.
    stats.bluffSuccessRate = bluffed.length > 0
      ? bluffed.filter(h => h[0].outcome === 'win').length / bluffed.length
      : 0.5;

    return stats;
  }

  private getAllRecords(db: IDBDatabase): Promise<DecisionRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private getSessionRecords(db: IDBDatabase, sessionId: string): Promise<DecisionRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => {
        resolve((req.result as DecisionRecord[]).filter(r => r.sessionId === sessionId));
      };
      req.onerror = () => reject(req.error);
    });
  }
}
