import { GameState, Card, Street, PlayerState, BlindSource } from '../../engine/types';
import { parseCardsCounted } from './card-parser';
import {
  readPot, readBetsOnTable, combinePot, readYourStack, readBlinds,
  readCostToCall, readMinRaise,
} from './table-reader';
import { readPlayers, readDealerSeatIndex } from './player-reader';
import { readAvailableActions } from './action-reader';
import { GameObserver, GameEvent } from './observers';
import { getPosition } from '../../engine/position';
import { SEL } from './selectors';

export type StateCallback = (state: GameState, trigger: GameEvent) => void;

/** The most community cards a Hold'em board can have. */
export const BOARD_CARDS = 5;

/** What can be read without holding cards ourselves. */
export interface TableSnapshot {
  street: Street;
  communityCards: Card[];
  players: PlayerState[];
  pot: number;
  bigBlind: number;
  smallBlind: number;
  yourStack: number;
  yourCurrentBet: number;
  dealerSeat: number;
  blindSource?: BlindSource;
}

/** The big blind as data: 0 unless it was read from the page this scrape. */
export function trustedBigBlind(
  s: { bigBlind: number; blindSource?: BlindSource } | null | undefined,
): number {
  if (!s || (s.blindSource !== undefined && s.blindSource !== 'read')) return 0;
  return s.bigBlind > 0 ? s.bigBlind : 0;
}

export type TableCallback = (table: TableSnapshot, trigger: GameEvent) => void;

/** Why a scrape failed, and how long it has been failing. */
export interface ScrapeFailure {
  message: string;
  /** Consecutive failed attempts — one-off animation glitches are normal. */
  consecutive: number;
}

export class GameStateScraper {
  private observer = new GameObserver();
  private callback: StateCallback | null = null;
  private tableCallback: TableCallback | null = null;

  /** The last blinds actually read, for a scrape that cannot see them. */
  private lastBlinds: { smallBlind: number; bigBlind: number } | null = null;

  /**
   * Swallowing every exception and returning null is what let a markup change
   * leave the extension permanently blind with the indicator still green.
   * Health checks only run once a state exists, so recording the failure is
   * what lets the controller say so out loud.
   */
  private failure: ScrapeFailure | null = null;

  getFailure(): ScrapeFailure | null {
    return this.failure;
  }

  private recordFailure(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    this.failure = { message, consecutive: (this.failure?.consecutive ?? 0) + 1 };
  }

  private recordSuccess(): void {
    this.failure = null;
  }

  /**
   * Blinds, falling back to the last ones actually read.
   *
   * duel.com shows the blinds in two places and neither is always available:
   * the posted chips exist only before anyone acts, and the raise button's
   * conversion only while a raise is on offer. Between the two most moments
   * are covered, and the last real reading covers the rest.
   *
   * A table we have never read blinds from gets zeros and a source of
   * 'default'. That is deliberate: `trustedBigBlind` hands back 0 for
   * anything not read this scrape, and `sanitizeAmount` floors a size at one
   * chip rather than dividing by an invented blind.
   */
  private resolveBlinds(): { smallBlind: number; bigBlind: number; blindSource: BlindSource } {
    const read = readBlinds();
    if (read.bigBlind > 0) {
      this.lastBlinds = {
        smallBlind: read.smallBlind > 0 ? read.smallBlind : read.bigBlind / 2,
        bigBlind: read.bigBlind,
      };
      return { ...this.lastBlinds, blindSource: 'read' };
    }
    if (this.lastBlinds) return { ...this.lastBlinds, blindSource: 'last-read' };
    return { smallBlind: 0, bigBlind: 0, blindSource: 'default' };
  }

  start(callback: StateCallback, onTable?: TableCallback, onFailure?: () => void): void {
    this.callback = callback;
    this.tableCallback = onTable || null;

    this.observer.start((event) => {
      const table = this.scrapeTableNow();
      if (table && this.tableCallback) this.tableCallback(table, event);
      else if (!table && onFailure) onFailure();

      const state = this.scrapeNow();
      if (state && this.callback) this.callback(state, event);
    });
  }

  stop(): void {
    this.observer.stop();
    // A new session may be a new table with its own blinds
    this.lastBlinds = null;
    this.callback = null;
    this.tableCallback = null;
  }

  /**
   * The board, or null if it could not be read whole.
   *
   * A card the parser cannot identify must not become a shorter board. The
   * count drives the street, so three cards with one unreadable becomes two,
   * which reads as preflop — and the preflop advisor then runs on a flop with
   * complete confidence. More than five is the same failure from the other
   * end and reaches an evaluator that accepts exactly seven cards in total.
   *
   * On duel.com an unreadable card most likely means an unrecognised suit
   * fingerprint, i.e. the artwork changed. That is exactly when guessing is
   * worst, and exactly when refusing is loudest.
   */
  private readBoard(): { cards: Card[] } | { error: string } {
    const board = parseCardsCounted(SEL.BOARD_CARDS);
    if (board.cards.length !== board.seen) {
      return { error: `read ${board.cards.length} of ${board.seen} community cards` };
    }
    if (board.cards.length > BOARD_CARDS) {
      return { error: `read ${board.cards.length} community cards, which is not a board` };
    }
    return { cards: board.cards };
  }

  /** Everything readable about the table without needing our own cards. */
  scrapeTableNow(): TableSnapshot | null {
    try {
      const players = readPlayers();
      if (players.length === 0) {
        this.recordFailure(new Error('no player seats found in the page'));
        return null;
      }

      const board = this.readBoard();
      if ('error' in board) {
        this.recordFailure(new Error(board.error));
        return null;
      }
      this.recordSuccess();

      const { smallBlind, bigBlind, blindSource } = this.resolveBlinds();
      const you = players.find(p => p.isYou);

      return {
        street: determineStreet(board.cards.length),
        communityCards: board.cards,
        players,
        pot: combinePot(readPot(), readBetsOnTable()),
        bigBlind,
        smallBlind,
        blindSource,
        yourStack: you?.stack ?? 0,
        yourCurrentBet: you?.currentBet ?? 0,
        dealerSeat: readDealerSeatIndex(),
      };
    } catch (e) {
      this.recordFailure(e);
      return null;
    }
  }

  scrapeNow(): GameState | null {
    try {
      const hole = parseCardsCounted(SEL.HERO_CARDS);
      if (hole.cards.length < 2) return null;

      /**
       * Record the refusal, do not merely return from it.
       *
       * This used to go quiet: a board that could not be read returned null
       * and said nothing, so whether the user ever found out depended on
       * `scrapeTableNow` having run first and recorded it. That is a real
       * dependency on call order for the one signal that says the extension
       * has gone blind — precisely the silent failure this project keeps
       * producing.
       */
      const board = this.readBoard();
      if ('error' in board) {
        this.recordFailure(new Error(board.error));
        return null;
      }

      const players = readPlayers();
      const you = players.find(p => p.isYou);
      const dealerSeatIndex = readDealerSeatIndex();
      const { smallBlind, bigBlind, blindSource } = this.resolveBlinds();
      const availableActions = readAvailableActions();

      /**
       * -1, not 0, when our own seat cannot be identified.
       *
       * Seat 0 hands us whatever position that seat happens to hold on a
       * table we have just failed to read. `getPosition` treats an unknown
       * seat as the earliest position, which is the conservative answer.
       */
      const yourSeatIndex = you?.seatIndex ?? -1;

      // Position comes from who was DEALT IN, not who is still in the hand:
      // a fold does not move anyone's seat
      const dealtInSeats = players
        .filter(p => p.isDealtIn ?? p.isActive)
        .map(p => p.seatIndex);

      return {
        holeCards: [hole.cards[0], hole.cards[1]] as [Card, Card],
        communityCards: board.cards,
        street: determineStreet(board.cards.length),
        pot: combinePot(readPot(), readBetsOnTable()),
        yourStack: readYourStack() || you?.stack || 0,
        yourCurrentBet: you?.currentBet ?? 0,
        costToCall: readCostToCall(),
        minRaise: readMinRaise(),
        bigBlind,
        smallBlind,
        blindSource,
        players,
        activePlayers: players.filter(p => p.isActive).length,
        position: getPosition(yourSeatIndex, dealerSeatIndex, dealtInSeats),
        dealerSeatIndex,
        availableActions,
      };
    } catch (e) {
      this.recordFailure(e);
      return null;
    }
  }
}

function determineStreet(communityCardCount: number): Street {
  switch (communityCardCount) {
    case 0: return 'preflop';
    case 3: return 'flop';
    case 4: return 'turn';
    case 5: return 'river';
    // Unreachable: readBoard refuses any other count rather than letting it
    // choose a street
    default: return communityCardCount < 3 ? 'preflop' : 'river';
  }
}
