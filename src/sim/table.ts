import { Card, Street } from '../engine/types';
import { createDeck } from '../engine/cards';
import { evaluate7 } from '../engine/hand-evaluator';
import { rand, makeRng } from '../shared/rng';

/**
 * A minimal but correct No-Limit Hold'em engine for self-play.
 *
 * Deliberately faithful on the things that change strategy conclusions:
 * blinds and position rotation, legal min-raises, all-ins, and proper
 * side-pot distribution. Deliberately simplified elsewhere: no rake, and
 * stacks reset each hand (a cash game with instant top-up), which is the
 * standard setup for measuring win rate in bb/100.
 */

export type SimAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // total committed THIS street

export interface SeatView {
  name: string;
  stack: number;      // chips still behind
  committed: number;  // chips in front of them this street
  totalIn: number;    // chips in across the whole hand
  folded: boolean;
  allIn: boolean;
  isYou: boolean;
}

export interface DecisionContext {
  holeCards: [Card, Card];
  board: Card[];
  street: Street;
  pot: number;          // everything in the middle, including this street
  toCall: number;       // chips needed to continue
  minRaiseTo: number;   // smallest legal raise-to for this street
  myStack: number;
  myCommitted: number;
  bigBlind: number;
  seatIndex: number;
  buttonIndex: number;
  seats: SeatView[];
  numActive: number;    // players not folded
  /**
   * Randomness for THIS hand, fixed by the deal seed.
   *
   * Bots drew from the global stream, so when one build acted differently
   * the bots consumed a different number of draws and every later hand
   * desynchronised — cards were paired but behaviour was not. Threading the
   * source through the context makes a hand fully reproducible from its
   * seed, whatever the hero does.
   */
  rng: () => number;
}

export interface SimPlayer {
  readonly name: string;
  decide(ctx: DecisionContext): Promise<SimAction> | SimAction;
  /** Optional hook so a player can observe results between hands. */
  onHandEnd?(net: number): void;
}

interface Seat {
  player: SimPlayer;
  hole: [Card, Card];
  stack: number;
  committed: number;
  totalIn: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
}

export interface HandResult {
  /** Net chips per seat index for this hand. */
  net: number[];
  /** Street the hand ended on. */
  endedOn: Street;
  wentToShowdown: boolean;
  /**
   * Each seat's hole cards, so a caller can record what was shown.
   *
   * Exposed only for measurement harnesses. No SimPlayer ever sees this —
   * `decide` receives only its own cards, and handing a bot the table's
   * holdings would make every result meaningless.
   */
  holeCards: [Card, Card][];
  /**
   * The community cards as they finished.
   *
   * Public information, unlike holeCards — an opponent judging what we showed
   * down needs the board we showed it on. Reconstructing it from the last
   * decision a player saw gives the turn when the hand ran to the river.
   */
  board: Card[];
  /**
   * Per seat: they put their last chip in as the AGGRESSOR, not by calling.
   *
   * The distinction is the one the shove read depends on, so measuring that
   * read requires the simulator to draw it the same way the extension does.
   */
  shoved: boolean[];
}

function shuffle(deck: Card[], rng: () => number = rand): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
}

export async function playHand(
  players: SimPlayer[],
  buttonIndex: number,
  /**
   * One stack for everyone (a cash game, where stacks reset each hand) or
   * one per seat (a tournament, where they carry over and someone busts).
   */
  startingStack: number | number[],
  bigBlind: number,
  /**
   * Fixes THIS hand's cards independently of every decision made in it.
   *
   * Two builds given the same dealSeed see the same deal even when they act
   * differently, which is the only way an A/B comparison measures play
   * rather than luck.
   */
  dealSeed?: number,
): Promise<HandResult> {
  const n = players.length;
  const shoved: boolean[] = new Array(n).fill(false);
  const smallBlind = bigBlind / 2;
  const handRng = dealSeed === undefined ? rand : makeRng(dealSeed);
  // A separate stream for decisions, so the number of bot draws can never
  // shift the cards even within one hand
  const decisionRng = dealSeed === undefined ? rand : makeRng(dealSeed ^ 0x5bf03635);
  const deck = createDeck();
  shuffle(deck, handRng);
  let d = 0;

  const stackOf = (i: number) =>
    Array.isArray(startingStack) ? startingStack[i] : startingStack;

  const seats: Seat[] = players.map((player, i) => ({
    player,
    hole: [deck[d++], deck[d++]] as [Card, Card],
    stack: stackOf(i),
    committed: 0,
    totalIn: 0,
    folded: false,
    allIn: false,
    hasActed: false,
  }));

  const post = (i: number, amount: number): void => {
    const put = Math.min(amount, seats[i].stack);
    seats[i].stack -= put;
    seats[i].committed += put;
    seats[i].totalIn += put;
    if (seats[i].stack === 0) seats[i].allIn = true;
  };

  // Heads-up: the button posts the small blind and acts first preflop
  const sbSeat = n === 2 ? buttonIndex : (buttonIndex + 1) % n;
  const bbSeat = n === 2 ? (buttonIndex + 1) % n : (buttonIndex + 2) % n;
  post(sbSeat, smallBlind);
  post(bbSeat, bigBlind);

  let board: Card[] = [];
  let street: Street = 'preflop';
  let currentBet = bigBlind;
  let lastRaiseSize = bigBlind; // for min-raise calculation
  let wentToShowdown = false;

  const liveCount = () => seats.filter(s => !s.folded).length;
  const canActCount = () => seats.filter(s => !s.folded && !s.allIn).length;
  const potSize = () => seats.reduce((sum, s) => sum + s.totalIn, 0);

  const roundClosed = (): boolean => {
    if (liveCount() <= 1) return true;
    const actors = seats.filter(s => !s.folded && !s.allIn);
    if (actors.length === 0) return true;
    // One player left who can act and they've already matched: nothing to do
    return actors.every(s => s.hasActed && s.committed === currentBet);
  };

  async function bettingRound(firstToAct: number): Promise<void> {
    for (const s of seats) s.hasActed = false;

    // Everyone is all-in (or only one can act with nothing to call)
    if (canActCount() === 0) return;
    if (canActCount() === 1 && liveCount() >= 2) {
      const lone = seats.find(s => !s.folded && !s.allIn)!;
      if (lone.committed >= currentBet) return;
    }

    let i = firstToAct;
    let guard = 0;

    while (!roundClosed()) {
      if (++guard > n * 40) break; // safety net against a misbehaving bot

      const seat = seats[i];
      const needsAction = !seat.folded && !seat.allIn
        && (!seat.hasActed || seat.committed < currentBet);

      if (needsAction) {
        const toCall = currentBet - seat.committed;
        const minRaiseTo = currentBet + lastRaiseSize;

        const ctx: DecisionContext = {
          holeCards: seat.hole,
          board: [...board],
          street,
          pot: potSize(),
          toCall: Math.min(toCall, seat.stack),
          minRaiseTo,
          myStack: seat.stack,
          myCommitted: seat.committed,
          bigBlind,
          seatIndex: i,
          buttonIndex,
          numActive: liveCount(),
          rng: decisionRng,
          seats: seats.map((s, idx) => ({
            name: s.player.name,
            stack: s.stack,
            committed: s.committed,
            totalIn: s.totalIn,
            folded: s.folded,
            allIn: s.allIn,
            isYou: idx === i,
          })),
        };

        let action: SimAction;
        try {
          action = await seat.player.decide(ctx);
        } catch {
          action = toCall > 0 ? { type: 'fold' } : { type: 'check' };
        }

        // Normalise illegal actions rather than trusting the bot
        if (action.type === 'check' && toCall > 0) action = { type: 'fold' };
        if (action.type === 'call' && toCall === 0) action = { type: 'check' };

        if (action.type === 'fold') {
          seat.folded = true;
        } else if (action.type === 'check') {
          // nothing to do
        } else if (action.type === 'call') {
          post(i, Math.min(toCall, seat.stack));
        } else {
          // Raise: clamp to legal bounds, or treat as a call if we can't
          const maxTo = seat.committed + seat.stack;
          let target = Math.min(action.to, maxTo);
          const isAllIn = target >= maxTo;
          if (!isAllIn && target < minRaiseTo) target = minRaiseTo;
          if (target <= currentBet && !isAllIn) {
            post(i, Math.min(toCall, seat.stack)); // degenerate raise → call
          } else {
            const raiseSize = target - currentBet;
            post(i, target - seat.committed);
            // Raised and left themselves nothing: a shove. Recorded here
            // rather than inferred from a zero stack afterwards, because a
            // player who CALLED all-in also ends on zero.
            if (seat.stack === 0) shoved[i] = true;
            if (raiseSize > 0) {
              // A full raise reopens the action for everyone else
              if (raiseSize >= lastRaiseSize) {
                for (const s of seats) {
                  if (s !== seat && !s.folded && !s.allIn) s.hasActed = false;
                }
                lastRaiseSize = raiseSize;
              }
              currentBet = Math.max(currentBet, target);
            }
          }
        }
        seat.hasActed = true;
      }

      if (liveCount() <= 1) break;
      i = (i + 1) % n;
    }
  }

  // ---- Preflop ----
  // Heads-up the button/SB acts first; otherwise it's the seat after the BB
  const firstPreflop = n === 2 ? sbSeat : (bbSeat + 1) % n;
  await bettingRound(firstPreflop);

  // ---- Postflop streets ----
  const streets: { street: Street; cards: number }[] = [
    { street: 'flop', cards: 3 },
    { street: 'turn', cards: 1 },
    { street: 'river', cards: 1 },
  ];

  for (const s of streets) {
    if (liveCount() <= 1) break;
    for (const seat of seats) seat.committed = 0;
    currentBet = 0;
    lastRaiseSize = bigBlind;
    for (let k = 0; k < s.cards; k++) board.push(deck[d++]);
    street = s.street;

    if (canActCount() >= 2) {
      // First to act postflop is the first live seat left of the button
      const first = n === 2 ? (buttonIndex + 1) % n : (buttonIndex + 1) % n;
      await bettingRound(first);
    }
  }

  // ---- Showdown / award ----
  if (liveCount() > 1) {
    wentToShowdown = true;
    while (board.length < 5) board.push(deck[d++]);
  }

  const net = awardPots(seats, board);
  for (let i = 0; i < seats.length; i++) {
    seats[i].player.onHandEnd?.(net[i]);
  }

  return {
    net, endedOn: street, wentToShowdown,
    holeCards: seats.map(s2 => s2.hole),
    shoved,
    board: [...board],
  };
}

/**
 * Distribute the pot, handling side pots. Each distinct all-in level forms
 * its own pot contested only by players who put in at least that much.
 */
function awardPots(seats: Seat[], board: Card[]): number[] {
  const n = seats.length;
  const net = seats.map(s => -s.totalIn);

  const live = seats.filter(s => !s.folded);
  if (live.length === 1) {
    const winner = seats.indexOf(live[0]);
    net[winner] += seats.reduce((sum, s) => sum + s.totalIn, 0);
    return net;
  }

  // Rank every live hand once
  const ranks = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (!seats[i].folded) {
      ranks.set(i, evaluate7([...seats[i].hole, ...board]));
    }
  }

  const levels = [...new Set(seats.filter(s => s.totalIn > 0).map(s => s.totalIn))]
    .sort((a, b) => a - b);

  let previousLevel = 0;
  for (const level of levels) {
    // Everyone who reached this level contributes to this pot
    let pot = 0;
    for (const s of seats) {
      pot += Math.max(0, Math.min(s.totalIn, level) - previousLevel);
    }
    if (pot <= 0) { previousLevel = level; continue; }

    // Contested by live players who put in at least this much
    const eligible: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!seats[i].folded && seats[i].totalIn >= level) eligible.push(i);
    }
    if (eligible.length === 0) { previousLevel = level; continue; }

    const best = Math.max(...eligible.map(i => ranks.get(i)!));
    const winners = eligible.filter(i => ranks.get(i) === best);
    const share = pot / winners.length;
    for (const w of winners) net[w] += share;

    previousLevel = level;
  }

  return net;
}
