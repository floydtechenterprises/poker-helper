import { GameState, Advice, Card } from '../engine/types';
import { StrategyEngine } from '../engine';
import { GameStateScraper, TableSnapshot, trustedBigBlind } from './scraper';
import { GameEvent } from './scraper/observers';
import { OverlayUI } from './ui/overlay';
import { EquityWorkerPool } from '../engine/equity/worker-pool';
import { estimateOpponentSpec, calculateEquity } from '../engine/equity/monte-carlo';
import { RangeSpec } from '../engine/equity/range-spec';
import { loadSettings, onSettingsChanged } from '../data/settings';
import { openDB, saveHand, getHandCount, getAllHands, clearDecisionLog, HandRecord } from '../data/db';
import { Settings, Message, AdvicePayload } from '../shared/messages';
import { isYourTurn, readAvailableActions, isChoosingAmount } from './scraper/action-reader';
import { runSelfCheck } from '../engine/self-check';
import { resolveAction } from '../engine/action-resolver';
import { getPosition } from '../engine/position';
import { cardToString } from '../engine/cards';
import { readPlayers, resetDealerSeat } from './scraper/player-reader';
import { LearningEngine, SessionState, DecisionRecord } from '../engine/learning';
import { HandFlowTracker, HeroHandActions } from './hand-flow';
import { HandBoundaryTracker } from './hand-boundary';
import { checkHealth, scrapeFailureIssues } from './health';
import { exportHandHistory } from '../data/hand-history';
import { analyseHands } from '../data/analysis';
import { installHotkey } from './hotkey';

/**
 * Longest the bet-sizing panel may suppress advice. Nobody spends 15 seconds
 * choosing a size in a two-minute blind level; past that, something is stuck.
 */
const MAX_AMOUNT_PANEL_MS = 15000;

// Case- and whitespace-insensitive name matching, shared with the scrapers
import { normaliseName } from '../shared/names';
export { normaliseName };

/**
 * Our name as the LOG spells it.
 *
 * The seat name comes off the table and the log's names out of its text, and
 * they were compared exactly. When the two differed in capitalisation or
 * spacing, nothing matched: our own cards were filed as an opponent's
 * showdown, our net read 0, and every flag about what we did (opened,
 * 3-bet, shoved) came back false (D6). Undefined when no log name matches.
 */

/** Write restored settings back, and tell the popup so it redraws. */

export function logNameFor(
  tableName: string | undefined,
  logNames: Iterable<string>,
): string | undefined {
  if (!tableName) return undefined;
  const wanted = normaliseName(tableName);
  for (const n of logNames) if (normaliseName(n) === wanted) return n;
  return undefined;
}

/**
 * The tracked opponent we are playing, if any.
 *
 * Learning is filed under this name, and a null here does not just leave one
 * decision unattributed: at load time it drops the whole per-opponent layer
 * back to the pooled history. It returned null whenever the tracked player
 * read as inactive or the table could not be read for a moment (L16).
 *
 *   1. a tracked opponent still in the hand;
 *   2. heads-up, the one tracked player seated even if read inactive for a
 *      tick — there is nobody else it could be;
 *   3. if the table cannot be read at all, the last opponent identified.
 *
 * Multiway a folded tracked player is not returned: a lesson from a pot he
 * left is not about him.
 */
export function opponentFor(
  players: { name: string; isYou: boolean; isActive?: boolean }[],
  reverseMappings: Record<string, string>,
  lastKnown: string | null,
): string | null {
  const tracked = (p: { name: string }) => reverseMappings[normaliseName(p.name)];
  for (const p of players) {
    if (p.isYou || p.isActive === false) continue;
    if (tracked(p)) return tracked(p);
  }
  const others = players.filter(p => !p.isYou);
  if (others.length === 1 && tracked(others[0])) return tracked(others[0]);
  if (players.length === 0) return lastKnown;
  return null;
}

/**
 * Label a finished hand for the history export.
 *
 * Chip change alone cannot describe a fold. Folding the button costs nothing
 * and used to record as 'unknown'; folding the big blind costs 20 and
 * recorded as 'loss' — the same decision landing in two different buckets,
 * and 'unknown' no longer meaning what it says. `HandRecord` has always
 * declared a 'fold' result; nothing ever assigned it.
 *
 * `folded` is undefined when we genuinely could not tell (the graphics path
 * with no readable seat), which is the one case 'unknown' is now reserved
 * for. Chips lost to blinds are still visible in the session totals — this
 * field describes what happened, not what it cost.
 */

export function classifyHandResult(
  net: number,
  folded: boolean | undefined,
): 'win' | 'loss' | 'fold' | 'unknown' {
  if (folded) return 'fold';
  if (net > 0) return 'win';
  if (net < 0) return 'loss';
  // Net zero without folding — a chopped pot, or an outcome we never saw
  return 'unknown';
}


/**
 * Cache key for one equity question.
 *
 * Must cover everything that can change the answer, and nothing that
 * cannot. Card ORDER cannot — the same two cards dealt either way around is
 * the same hand — so both lists are sorted; without that, a re-render that
 * happens to read the seats in a different order would miss the cache and
 * resample, which is the flicker this exists to stop.
 *
 * The range spec is included in full. Two spots with the same hole cards on
 * the same board are still different questions if the opponent's assumed
 * range differs, and sharing an answer between them would silently reuse the
 * wrong one.
 */
export function equityKey(
  hole: Card[], board: Card[], opponents: number, spec: RangeSpec,
  /**
   * Sample count, because it changes the ANSWER's precision.
   *
   * Leaving it out made the Analysis speed setting silently useless: every
   * spot already cached kept its old, coarser number, so switching Fast to
   * Deep changed nothing visible and there was no way to tell why. A setting
   * that appears to do nothing is worse than one that isn't there.
   */
  iterations = 0,
): string {
  const enc = (c: Card) => c.rank * 4 + c.suit;
  const h = hole.map(enc).sort((a, b) => a - b).join(',');
  const b = board.map(enc).sort((a, b2) => a - b2).join(',');
  return `${h}|${b}|${opponents}|${spec.percentile.toFixed(3)}`
    + `|${spec.valueWeight.toFixed(3)}|${spec.minCategory}|${spec.valueOpponents ?? 0}`
    + `|${iterations}`;
}



export class GameController {
  private scraper = new GameStateScraper();
  private engine = new StrategyEngine();
  private overlay = new OverlayUI();
  private workerPool = new EquityWorkerPool();
  /**
   * Equity per distinct spot, so the same decision always shows the same
   * number.
   *
   * Monte Carlo is stochastic: 5000 samples at 25% equity carry a standard
   * error around 0.6%, so re-running it legitimately returns 24%, then 26%,
   * then 25%. This ran on EVERY DOM mutation — and PokerNow mutates
   * constantly — so a single unchanged decision was re-sampled dozens of
   * times while the user looked at it. Sitting on a pot-odds boundary, that
   * flipped the recommendation between CALL and FOLD over and over, which
   * reads as the advice being confused rather than the spot being close.
   *
   * The key covers everything that can change the answer, so a genuine
   * change in the hand still recomputes. Only the noise is removed.
   */
  private equityCache = new Map<string, number>();
  private learning = new LearningEngine();
  /** Store an equity result, keeping the cache bounded on long sessions. */
  private rememberEquity(key: string, equity: number): void {
    if (this.equityCache.size > 5000) this.equityCache.clear();
    this.equityCache.set(key, equity);
  }
  private settings: Settings | null = null;
  private lastAdvice: Advice | null = null;
  private adviceStreet: GameState['street'] | null = null;
  /** Removes the hotkey listener when the session stops. */
  private removeHotkey: (() => void) | null = null;
  /** When every opponent first read as folded on our turn, or null. */
  private noLiveOpponentSince: number | null = null;
  /** When the bet-sizing panel was first seen open, or null. */
  private choosingAmountSince: number | null = null;
  private evaluating = false;
  private evaluatingSince: number | null = null;
  private wasYourTurn = false;
  private flow = new HandFlowTracker();
  private boundary = new HandBoundaryTracker();
  private lastObservedState: GameState | null = null;
  private lastTable: TableSnapshot | null = null;
  private historyWrite: Promise<void> = Promise.resolve();
  /**
   * Watchdog state for the log path.
   *
   * Deferring to the log suppresses the graphics settle, so a log that is
   * present but silent stops all recording. These let the session notice
   * that and take the job back.
   */
  /**
   * The log has delivered at least one hand, so it owns the settling job
   * until the watchdog says otherwise. Stops a one-tick availability blip
   * from handing the same hand to both paths.
   */
  /** Whether the learning history actually loaded — see checkHealth. */
  private learningLoaded = false;

  private session: SessionState | null = null;
  private playerMappings: Record<string, string> = {}; // tracked name -> in-game username

  async start(): Promise<void> {
    /**
     * The listener goes up FIRST, before anything that can fail or hang.
     *
     * It used to sit behind `await loadSettings()` and `await
     * workerPool.init()`. The worker is fetched as a web-accessible resource,
     * so if that request hangs — or the page's CSP refuses it, or storage is
     * slow — `start()` never reaches this line and the listener is never
     * registered. The tab is open, the content script is running, and every
     * popup request comes back as "No PokerNow tab found", which reads as the
     * extension being broken while the page is plainly right there.
     *
     * This is the third time this exact failure has been fixed. First the
     * listener waited for a `.table` element; then it waited on a 60-second
     * timeout that gave up permanently; now it was waiting on the worker.
     * Each fix removed one dependency and left the others in front of it.
     *
     * So the rule, rather than another instance: ANSWERING THE POPUP MUST
     * DEPEND ON NOTHING. Not settings, not workers, not the DOM. Everything
     * else can fail and the extension is merely degraded; if this fails the
     * extension is unreachable and cannot even report why.
     */
    chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      this.handleMessage(msg, sendResponse);
      return true; // async response
    });

    this.settings = await loadSettings();

    // Init workers (async — falls back to main-thread MC if unavailable)
    await this.workerPool.init();

    // Listen for settings changes
    onSettingsChanged((settings) => {
      this.settings = settings;
    });

    // Refresh the popup-readable cache as soon as we're on the page, so the
    // learning panel has data even before a session is started
    void this.persistLearningSnapshot();
  }

  async startFromPending(payload: any): Promise<void> {
    if (this.session) return;
    await this.startSession(payload);
  }

  /**
   * Always answer, even when the work fails.
   *
   * Individual cases had their own try/catch; START_SESSION, STOP_SESSION and
   * the mapping handler did not. A throw there — a database that will not
   * open, a scrape that dies — meant `sendResponse` was never called at all,
   * so the popup sat waiting on a port that only closes when the tab does.
   * The user sees a button that did nothing and no reason why.
   *
   * The wrapper answers with the error instead of silence.
   */
  private async handleMessage(msg: Message, sendResponse: (response?: any) => void): Promise<void> {
    try {
      await this.routeMessage(msg, sendResponse);
    } catch (err) {
      console.error('[Poker Advisor] Message failed', msg?.type, err);
      try {
        sendResponse({ ok: false, error: (err as Error)?.message || 'failed' });
      } catch { /* the port may already be gone; nothing more to do */ }
    }
  }

  private async routeMessage(msg: Message, sendResponse: (response?: any) => void): Promise<void> {
    switch (msg.type) {
      case 'START_SESSION':
        await this.startSession(msg.payload);
        sendResponse({ ok: true });
        break;

      case 'STOP_SESSION':
        await this.stopSession();
        sendResponse({ ok: true });
        break;

      case 'GET_SESSION_STATE':
        sendResponse({
          isRunning: this.session !== null,
          startingBalance: this.session?.startingBalance || 0,
          advice: this.session && this.lastAdvice ? this.buildAdvicePayload(this.lastAdvice) : null,
        });
        break;

      case 'GET_TABLE_PLAYERS': {
        // Live list of who's actually sitting at the table right now, so the
        // popup can offer real usernames instead of making you type them.
        // Read seats directly — this must work between hands too, when no
        // hole cards are dealt and a full state scrape would return null.
        const names = readPlayers()
          .filter(p => !p.isYou && !/^Player \d+$/.test(p.name) && p.name.length > 0)
          .map(p => p.name);
        sendResponse({
          players: [...new Set(names)],
          mappings: { ...this.playerMappings },
          isRunning: this.session !== null,
        });
        break;
      }

      case 'GET_LEARNING_STATS':
        try {
          await this.persistLearningSnapshot();
          sendResponse({ snapshot: this.learning.getSnapshot() });
        } catch {
          sendResponse({ snapshot: null });
        }
        break;

      case 'RESET_LEARNING':
        try {
          await clearDecisionLog();
          if (this.session) this.session.decisions = [];
          await this.persistLearningSnapshot(); // recomputes from empty log
          sendResponse({ ok: true, snapshot: this.learning.getSnapshot() });
        } catch {
          sendResponse({ ok: false });
        }
        break;

      case 'RUN_SELF_CHECK':
        try {
          const db = await openDB();
          // Learning is no longer scoped to a named opponent: there is no
        // name to scope it to. One set of stats for the session.
        await this.learning.loadStats(db);
          const params = this.learning.getLearnedParams();
          const results = await runSelfCheck(params);
          sendResponse({
            results,
            params,
            snapshot: this.learning.getSnapshot(),
          });
        } catch {
          sendResponse({ results: null });
        }
        break;

      case 'GET_SCRAPER_DEBUG': {
        // What the scraper can see on the page right now, for eyeballing
        // against the actual table
        const st = this.scraper.scrapeNow();
        const seats = readPlayers();
        sendResponse({
          gotState: st !== null,
          yourTurn: isYourTurn(),
          availableActions: readAvailableActions(),
          state: st ? {
            holeCards: st.holeCards.map(cardToString),
            communityCards: st.communityCards.map(cardToString),
            street: st.street,
            pot: st.pot,
            yourStack: st.yourStack,
            costToCall: st.costToCall,
            bigBlind: st.bigBlind,
            smallBlind: st.smallBlind,
            position: st.position,
            activePlayers: st.activePlayers,
            heroIsPreflopAggressor: st.heroIsPreflopAggressor,
          } : null,
          seats: seats.map(p => ({
            name: p.name, stack: p.stack, bet: p.currentBet,
            active: p.isActive, you: p.isYou,
          })),
          mappings: { ...this.playerMappings },
          tracking: {
            sessionRunning: this.session !== null,
            handsThisSession: this.session?.handsPlayed ?? 0,
            // Which mapped friends are actually matching a seat right now.
            // A mapping that matches nothing is the usual reason a profile
            // stays empty, and it's invisible without this.
            matches: Object.entries(this.playerMappings).map(([tracked, ingame]) => ({
              tracked,
              ingame,
              matchedSeat: seats.some(p => !p.isYou && normaliseName(p.name) === normaliseName(ingame)),
            })),
          },
        });
        break;
      }

      case 'GET_HAND_COUNT':
        try {
          const count = await getHandCount();
          sendResponse({ count });
        } catch {
          sendResponse({ count: 0 });
        }
        break;

      case 'ANALYSE_OPPONENT':
        // The hand history lives in IndexedDB on the GAME page's origin, so
        // the popup cannot read it directly — it has to ask us.
        try {
          const hands = await getAllHands();
          sendResponse({
            ok: true,
            report: analyseHands(hands, msg.payload?.opponent, cardToString),
          });
        } catch {
          sendResponse({ ok: false });
        }
        break;

      // Hand the JSON back rather than downloading it here. Only the content
      // script can read the database (IndexedDB is scoped to the game
      // origin), but only the popup can actually save a file — PokerNow's
      // CSP blocks a blob: download from this context without reporting a
      // thing. Read here, write there.      case 'EXPORT_HAND_HISTORY':
        try {
          sendResponse({ ok: true, json: await exportHandHistory() });
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error)?.message || 'export failed' });
        }
        break;

      default:
        sendResponse({ ok: false });
    }
  }

  private async startSession(payload: any): Promise<void> {
    // Guard against double-start (pending-session pickup + relayed message)
    if (this.session) return;

    const { gameUrl, startingBalance, playerMappings } = payload;

    /**
     * Read the starting stack off the table rather than being told it.
     *
     * The popup used to demand a number before it would start, because
     * PokerNow gave it no way to know what you had sat down with. duel.com
     * renders the stack on the felt, so asking would be asking for
     * something already on screen — and a typed figure can only ever
     * disagree with it.
     *
     * A payload figure still wins if one is supplied, so a caller that
     * genuinely knows better is not overridden. Zero, which is what the
     * popup now sends, means "look it up".
     */
    const scrapedStack = this.scraper.scrapeTableNow()?.yourStack ?? 0;
    const openingBalance = startingBalance > 0 ? startingBalance : scrapedStack;

    this.session = {
      sessionId: `session-${Date.now()}`,
      gameUrl,
      startingBalance: openingBalance,
      currentBalance: openingBalance,
      startTime: Date.now(),
      handsPlayed: 0,
      handsWon: 0,
      handsLost: 0,
      biggestWin: 0,
      biggestLoss: 0,
      playerMappings: playerMappings || {},
      decisions: [],
    };

    // Start every session from clean per-hand state
    this.boundary.reset();
    this.flow.reset();
    // The button is per-table state too: keeping the previous game's seat
    // would derive every position of the next session from it
    resetDealerSeat();
    this.lastObservedState = null;
    this.lastTable = null;

    // Load learning stats
    if (this.settings?.learningMode === 'on') {
      try {
        const db = await openDB();
        // Learning is no longer scoped to a named opponent: there is no
        // name to scope it to. One set of stats for the session.
        await this.learning.loadStats(db);
        this.learningLoaded = true;
      } catch {
        // Swallowed for the session's sake, but recorded so the health
        // check can say that learning is inert rather than silently doing
        // nothing for the rest of the night
        this.learningLoaded = false;
      }
    }

    // Create overlay
    if (this.settings?.overlayEnabled) {
      this.overlay.create(
        this.settings.overlayX,
        this.settings.overlayY,
        this.settings.collapsed,
        this.settings.overlayWidth,
        this.settings.overlayHeight,
      );
    }


    /**
     * One key to take the recommended action.
     *
     * Nothing here ever acts on its own — the listener only runs when the
     * user presses the key, and every guard lives in refuseReason. A blind
     * level lasting two minutes leaves no time to read advice, find the
     * button and type a size; this removes that, and nothing else.
     */
    this.removeHotkey = installHotkey({
      getAdvice: () => (this.lastAdvice && this.adviceStreet
        ? {
          action: this.lastAdvice.action,
          amount: this.lastAdvice.amount,
          street: this.adviceStreet,
        }
        : null),
      getStreet: () => this.lastObservedState?.street ?? null,
      isYourTurn: () => isYourTurn(),
      onResult: (message) => this.overlay.flashHotkeyResult(message),
    });

    // Start scraper — table events drive whole-hand tracking (they fire even
    // when we've folded), full-state events drive advice
    this.scraper.start(
      (state, event) => this.onGameStateChange(state, event),
      (table) => { void this.onTableChange(table); },
      () => this.onScrapeFailed(),
    );

    // Initial scrape
    const initialState = this.scraper.scrapeNow();
    if (initialState) {
      this.onGameStateChange(initialState, 'state-change');
    }
  }

  /**
   * Persist a compact summary of the current session to chrome.storage.local
   * (shared with the popup, unlike IndexedDB which is per-origin). Called
   * after every hand and on stop, so a crash never loses the session.
   */
  private saveSessionSummary(ended: boolean): void {
    if (!this.session) return;
    const s = this.session;
    const summary = {
      sessionId: s.sessionId,
      gameUrl: s.gameUrl,
      startTime: s.startTime,
      endTime: ended ? Date.now() : null,
      startingBalance: s.startingBalance,
      finalBalance: s.currentBalance,
      profit: s.currentBalance - s.startingBalance,
      handsPlayed: s.handsPlayed,
      handsWon: s.handsWon,
      handsLost: s.handsLost,
      biggestWin: s.biggestWin,
      biggestLoss: s.biggestLoss,
    };

    // Serialize read-modify-write so two hands finishing close together
    // can't both read the old array and drop one of the updates
    this.historyWrite = this.historyWrite.then(() => new Promise<void>((resolve) => {
      chrome.storage.local.get('sessionHistory', (result) => {
        const history: any[] = Array.isArray(result.sessionHistory) ? result.sessionHistory : [];
        const idx = history.findIndex(h => h.sessionId === summary.sessionId);
        if (idx >= 0) history[idx] = summary;
        else history.push(summary);
        // Keep the last 100 sessions
        chrome.storage.local.set({ sessionHistory: history.slice(-100) }, () => resolve());
      });
    })).catch(() => {});
  }




  private async stopSession(): Promise<void> {
    /**
     * Settle what the session still owes before it closes (D14).
     *
     * This used to coordinate two settle paths: the session log, which only
     * closes a hand when the next one starts and so lags the table by one,
     * and the graphics. After Stop neither fired and the last hand was
     * recorded by nobody. The log path has gone with the profiling it fed,
     * so the graphics are the only settle now and the coordination with it.
     */
    const open = this.lastTable
      ? this.boundary.finish(this.lastTable.yourStack, this.lastTable.yourCurrentBet)
      : null;
    if (open && open.profitLoss !== 0) {
      try {
        await this.onHandComplete(
          this.lastTable, this.lastObservedState,
          open.profitLoss, open.handStartTime,
          this.flow.snapshot(),
        );
      } catch {}
    }

    this.saveSessionSummary(true);
    this.scraper.stop();
    this.overlay.destroy();
    // Stop listening the moment the session ends, so a stray keypress on a
    // finished table can never act
    this.removeHotkey?.();
    this.removeHotkey = null;

    // Clear ALL per-hand state — stale values would make the next session
    // settle a phantom hand using the previous session's stack
    this.boundary.reset();
    this.flow.reset();
    // The dealer button is per-table state as well
    resetDealerSeat();
    this.lastObservedState = null;
    this.lastTable = null;
    this.wasYourTurn = false;
    this.evaluating = false;
    this.evaluatingSince = null;
    // Anything still queued sees a null session and returns; the counter is
    // reset so a new session does not start against a stale backlog
    this.tableQueue = Promise.resolve();
    this.queuedTableEvents = 0;

    this.session = null;
    this.lastAdvice = null;
    this.playerMappings = {};
    chrome.storage.local.remove('activePlayerMappings');
  }

  /**
   * Whole-hand tracking. Runs on every table event — including hands we
   * folded out of, where no hole cards exist and the full-state scrape
   * returns nothing. Hand boundaries, opponent actions and showdown cards
   * all depend on seeing those hands.
   */
  /**
   * The table could not be read at all.
   *
   * Every other health check runs off a successfully scraped state, so this
   * is the one failure mode nothing was watching: a reader throwing left the
   * extension blind while the indicator kept showing green from the last
   * good hand. Surfacing it is the whole point — bad input producing
   * confident advice is worse than no advice.
   */
  private onScrapeFailed(): void {
    if (!this.session) return;
    const issues = scrapeFailureIssues(this.scraper.getFailure());
    if (issues.length > 0) {
      this.overlay.showHealth(issues);
      this.overlay.showError("Can't read the table — see the warning above");
    }
  }

  /**
   * Table events run one at a time, in order.
   *
   * `onTableChange` is fire-and-forget from the observer and awaits real work
   * inside — settling a hand writes to IndexedDB and saves every tracked
   * profile. The observer fires again 150ms later, so a second call could
   * enter while the first was suspended on a write, and the two then raced
   * over `lastTable`, `pendingShowdowns`, and the per-hand trackers.
   *
   * The worst ordering is concrete: the second call's `actions.update()`
   * landing before the first call's `actions.reset()`, folding one hand's
   * actions into the next hand's statistics.
   *
   * `onGameStateChange` guards itself with an `evaluating` flag and simply
   * SKIPS overlapping calls, which is fine when the work is recomputing
   * advice — the next event redoes it. Here skipping could drop a hand
   * boundary, so these are queued rather than dropped.
   */
  private tableQueue: Promise<void> = Promise.resolve();
  private queuedTableEvents = 0;

  private onTableChange(table: TableSnapshot): Promise<void> {
    /**
     * A depth cap, because an unbounded queue is its own failure.
     *
     * If handlers ever run slower than events arrive, chaining forever would
     * process an ever-staler backlog while the game moved on. Beyond a couple
     * of pending events the newest snapshot is what matters, and dropping an
     * intermediate one costs nothing: the next event carries current state.
     */
    if (this.queuedTableEvents > 2) return this.tableQueue;

    this.queuedTableEvents++;
    this.tableQueue = this.tableQueue
      .then(() => this.handleTableChange(table))
      .catch(() => { /* one bad event must not stall the queue forever */ })
      .finally(() => { this.queuedTableEvents--; });
    return this.tableQueue;
  }

  private async handleTableChange(table: TableSnapshot): Promise<void> {
    if (!this.session) return;

    // The session log is authoritative when we can read it: it states hand
    // boundaries, the dealer and every action outright, instead of us
    // inferring them from the table graphics.
    /**
     * The log is preferred, but only while it is actually delivering hands.
     *
     * Deferring to it means SUPPRESSING the graphics settle below, so a log
     * path that silently produces nothing does not degrade recording — it
     * stops it dead. That is not hypothetical: a misidentified container had
     * profiles, learning and hand history frozen for entire sessions, with
     * the only visible symptom a hands counter that would not move.
     *
     * `isAvailable` is now an honest readability check, which fixes the known
     * cause. This is the guard for the unknown ones: if hands keep finishing
     * on the table while the log has never once produced a completed hand,
     * stop believing it and let the graphics carry the session.
     */
    /**
     * Which source settles hands must not flicker.
     *
     * `isAvailable()` is recomputed every tick and re-finds the container each
     * time, so it can answer false for a single tick — a re-render, a
     * collapsed panel, a momentarily empty list — and true again immediately
     * after. Deciding per tick means one hand settles through the log and the
     * next through the graphics, and a hand caught across the boundary settles
     * through BOTH.
     *
     * That is very likely what produced the duplicate records in the exported
     * history: 100 pairs, seconds apart, identical cards, board and net. A
     * duplicate is not merely noise — each copy is a second vote in the
     * profile and learning data, so the opponent's numbers drift toward
     * whatever happened on the hands that happened to be double-counted.
     *
     * So the choice is sticky. Once the log has delivered a hand we keep
     * using it through a blip, and the only way back to the graphics is the
     * watchdog deciding it is properly dead — which latches, and cannot
     * hand the job back again.
     */
    const otherMaxBet = Math.max(
      0, ...table.players.filter(p => !p.isYou).map(p => p.currentBet),
    );

    // The boundary tracker flips its own guard before returning, so a second
    // observer event during the await below can't settle the same hand twice
    const finished = this.boundary.observe({
      street: table.street,
      yourStack: table.yourStack,
      yourCurrentBet: table.yourCurrentBet,
      dealerSeat: table.dealerSeat,
      // "Player N" placeholders are numbered by index, so they shift too
      dealerName: [table.players.find(p => p.seatIndex === table.dealerSeat)?.name]
        .find(n => n && !/^Player \d+$/.test(n)),
    });
    // The table snapshot always carries our stack, even on hands we folded
    // out of and have no cards for — so the running balance stays current
    // instead of freezing whenever we're not in the hand.
    //
    // Must match updateBalance exactly: chips BEHIND, excluding anything
    // already wagered. Two paths writing two different definitions made
    // the profit figure jump around mid-hand.
    if (this.session && table.yourStack > 0) {
      this.session.currentBalance = table.yourStack;
    }

    const stateForCompletedHand = this.lastObservedState;
    const tableForCompletedHand = this.lastTable;
    this.lastTable = table;

    if (finished) {
      /**
       * Grade our own decisions from the TABLE boundary, always.
       *
       * The log path stamped outcomes using `hand.startedAt`, which the
       * tracker sets to `Date.now()` at the moment it READS the hand-start
       * line — not when the hand was played. PokerNow's log modal lags the
       * table by a hand, so that timestamp lands AFTER every decision the
       * hand contains. `stampHandOutcome` filters `timestamp >= handStartTs`,
       * matched nothing, and graded none of them.
       *
       * Observed live, and it is the whole reason the learning layer has
       * never once adjusted anything: "300 decisions recorded, 0 hands
       * graded". Unresolved decisions never reach the bluff or call
       * thresholds, so every dial sat at neutral no matter how much was
       * played.
       *
       * The table boundary is real-time and knows the true start, so grading
       * belongs here regardless of which path settles the profiles. The log
       * path no longer grades at all (L1), and stamping now stops at the
       * moment the hand ended (L2).
       */
      if (this.settings?.learningMode === 'on' && finished.profitLoss !== 0 && this.session) {
        const sessionId = this.session.sessionId;
        const { profitLoss, handStartTime } = finished;
        // Taken now, before the async hop: the next hand's decisions come
        // after this moment and must not be graded as part of this one
        const handEndTime = Date.now();
        void (async () => {
          try {
            const db = await openDB();
            await this.learning.updateOutcome(
              db, sessionId, handStartTime,
              profitLoss > 0 ? 'win' : 'loss', profitLoss, handEndTime,
            );
            // Learning is no longer scoped to a named opponent: there is no
        // name to scope it to. One set of stats for the session.
        await this.learning.loadStats(db);
          } catch {}
        })();
      }
      /**
       * Has the log gone quiet while hands are visibly finishing?
       *
       * Checked BEFORE settling, so the hand that trips the watchdog is the
       * one that gets recorded rather than the one after it.
       *
       * The threshold is not 1. The tracker closes a hand when it sees the
       * NEXT hand's start line, so a one-hand lag between the table and the
       * log is normal and expected. Three consecutive finished hands with
       * nothing at all from the log is not lag, it is a dead reader.
       *
       * Latching rather than toggling: once abandoned the log stays abandoned
       * for the session. A source that flickers in and out would settle some
       * hands twice and others not at all, which is worse than either choice
       * made consistently.
       */
      /**
       * CONSECUTIVE silence, not "never worked".
       *
       * This first counted only while the log had never produced a hand, so
       * one successful hand disabled the watchdog for the rest of the
       * session — and a log that works for two hands and then stops (panel
       * closed mid-game, container replaced by a re-render, scroll anchor
       * lost) would silently take all recording down with it, which is the
       * exact failure the watchdog exists to catch.
       *
       * The counter is cleared every time the log delivers, so it measures
       * the gap since the last hand it produced rather than the gap since the
       * session began.
       */
      /**
       * Silence only counts once the log has actually started a hand.
       *
       * The budget was being spent before the log had a chance to use it. Two
       * delays stack at the start of a session: the tracker closes a hand only
       * when it sees the NEXT hand's start line, and PokerNow's log modal
       * shows one hand at a time and lags the table by one. So the first log
       * hand cannot appear until roughly the third table hand — which is
       * where the limit used to sit exactly.
       *
       * The watchdog therefore fired at almost the moment the log would have
       * begun working, then latched for the session. Reported live as
       * "Session log gave up — 0 hands read", with the log open on screen and
       * every one of its lines parsing correctly when tested directly.
       *
       * `isInHand()` is true once a hand-start line has been consumed. Before
       * that the log has not begun tracking anything, so its silence is
       * expected rather than evidence of a fault. Raising the limit instead
       * would have been worse: while the log is trusted the graphics do not
       * settle, so every hand of budget is a hand recorded by nobody.
       */
      // Read BEFORE the reset below — the tracker is cleared here and
      // onHandComplete runs after, so asking it later always answers false.
      const heroSnapshot = this.flow.snapshot();
      this.flow.reset();
        this.lastObservedState = null; // belongs to the hand just finished
      // The log path is gone, so the graphics always settle the hand.
      await this.onHandComplete(
        tableForCompletedHand, stateForCompletedHand,
        finished.profitLoss, finished.handStartTime, heroSnapshot,
      );
    }

    // Advice computed on an earlier street is worthless and dangerous to
    // act on. If the board has moved on and we haven't produced fresh
    // advice, blank the overlay rather than leave a stale action showing.
    if (this.lastAdvice && this.adviceStreet !== null && this.adviceStreet !== table.street) {
      this.lastAdvice = null;
      this.adviceStreet = null;
      this.overlay.showWaiting();
    }

    /**
     * Blinds never read are not fed to the hand trackers (D15).
     *
     * Both tell a blind post from a raise by comparing it to the big blind,
     * so against the placeholder of 1 every post was a raise: VPIP and PFR on
     * every hand, and our own "open" on every blind. Skipped, the hand is
     * simply not tracked — no data rather than wrong data.
     */
    if (table.blindSource === 'default') return;

    const heroSeat = table.players.find(p => p.isYou)?.seatIndex ?? -1;
    this.flow.update({
      street: table.street,
      heroBet: table.yourCurrentBet,
      otherMaxBet,
      bigBlind: table.bigBlind,
      heroStack: table.yourStack,
      // Unknown seats leave this false, which keeps the old behaviour rather
      // than guessing a seat we cannot see
      heroInBigBlind: heroSeat >= 0 && table.dealerSeat >= 0 && getPosition(
        heroSeat, table.dealerSeat,
        table.players.filter(p => p.isDealtIn ?? p.isActive).map(p => p.seatIndex),
      ) === 'BB',
    });
  }

  private async onGameStateChange(state: GameState, event: GameEvent): Promise<void> {
    if (!this.session) return;

    /**
     * Do not re-advise while the bet-sizing panel is open.
     *
     * Opening it swaps the action buttons for presets, so FOLD and CHECK
     * vanish from the page. The scraper honestly reports that checking is
     * unavailable, and the engine — told it can no longer check — changes
     * its mind: a CHECK recommendation flipped to BET the moment the panel
     * was opened to look at it.
     *
     * Nothing about the poker changed. We are part-way through acting on the
     * advice we already have, so that advice must stand.
     */
    if (isChoosingAmount()) {
      // ...but never forever. If the panel is somehow always "open", this
      // would silently stop all advice with nothing to show for it, so the
      // freeze is capped and we carry on regardless.
      this.choosingAmountSince ??= Date.now();
      if (Date.now() - this.choosingAmountSince < MAX_AMOUNT_PANEL_MS) return;
    } else {
      this.choosingAmountSince = null;
    }

    this.lastObservedState = state;

    state.heroIsPreflopAggressor = this.flow.isHeroPreflopAggressor();
    state.flopWasChecked = this.flow.flopWasChecked();
    state.heroBetFlop = this.flow.didHeroBetFlop();
    state.heroBetTurn = this.flow.didHeroBetTurn();

    // Skip if already evaluating, but add a safety timeout to prevent getting stuck
    if (this.evaluating) {
      if (this.evaluatingSince && Date.now() - this.evaluatingSince > 10000) {
        console.warn('[Poker Advisor] Evaluation stuck for 10s, resetting');
        this.evaluating = false;
      } else {
        return;
      }
    }

    const yourTurn = isYourTurn();

    /**
     * No decision of ours, no advice — whatever woke us up.
     *
     * This was conditional on `event === 'state-change'`, which was right on
     * PokerNow: the buttons are always in the DOM there and merely disabled,
     * so a 'turn' event genuinely meant the offer had changed. Here the
     * buttons are absent when it is not our turn, the decisions observer was
     * reporting ordinary table movement as 'turn', and 'turn' outranks
     * everything else in the debounce — so the one event allowed to skip
     * this guard was the one being fired constantly.
     *
     * What the user saw: having opened for 125 with the opponent still
     * deciding, the panel recomputed and told them to raise to 300. Advice
     * formed while someone else is acting is wrong by construction, because
     * the price of the hand is not settled yet, so the event type should
     * never have been able to buy an exemption from this.
     *
     * Whole-hand tracking is unaffected: that runs off the table callback,
     * which is a separate path and still sees every event.
     */
    if (!yourTurn) {
      this.updateBalance(state);
      if (yourTurn !== this.wasYourTurn) {
        this.overlay.showWaiting();
      }
      this.wasYourTurn = yourTurn;
      return;
    }

    this.wasYourTurn = yourTurn;

    if (!state.holeCards || state.holeCards.length < 2) {
      this.overlay.showWaiting();
      return;
    }

    this.evaluating = true;
    this.evaluatingSince = Date.now();
    /**
     * Only claim a decision state while a decision is actually ours.
     *
     * Shown unconditionally this blinks between WAIT and CLICK throughout the
     * opponent's turn, because the engine re-evaluates on every DOM mutation.
     * Motion in the corner of the eye that means nothing is worse than no
     * indicator at all.
     */
    this.overlay.showDecisionState(yourTurn ? false : null);

    try {
      // Check the data feeding this decision before trusting it
      // A hand ending marks the folder and clears the buttons in separate
      // frames, so for an instant it looks like our turn with nobody left.
      // Only a run of these means fold detection is genuinely broken.
      const everyoneFolded = state.players.some(p => !p.isYou)
        && state.players.filter(p => !p.isYou).every(p => !p.isActive);
      if (everyoneFolded && yourTurn) {
        this.noLiveOpponentSince ??= Date.now();
      } else {
        this.noLiveOpponentSince = null;
      }

      this.overlay.showHealth(checkHealth({
        noLiveOpponentMs: this.noLiveOpponentSince ? Date.now() - this.noLiveOpponentSince : 0,
        players: state.players,
        pot: state.pot,
        /**
         * The blind the engine is actually sizing with, not a stricter one.
         *
         * This passed `trustedBigBlind`, which is 0 for anything not read on
         * this very scrape. But the scraper deliberately caches the last
         * level it read and hands it back as 'last-read', because neither
         * source is continuously on screen — and nothing re-reads the blind
         * on the flop, where there are no posts and no raise button. So the
         * panel declared every bet size wrong while the engine was sizing
         * off a perfectly good level read seconds earlier, in the middle of
         * a hand it had advised correctly.
         *
         * `state.bigBlind` is 0 exactly when no level has ever been read,
         * which is the only case that genuinely breaks sizing. The strict
         * reading is still right for the hand record at the end of this
         * function, where a cached level must not be written down as fact.
         */
        bigBlind: state.bigBlind,
        communityCardCount: state.communityCards.length,
        haveHoleCards: state.holeCards.length >= 2,
        yourTurn,
        availableActions: state.availableActions,
        mappings: this.playerMappings,
        /**
         * Abandoned counts as unavailable, whatever the reader says.
         *
         * The watchdog can decide mid-session that the log is dead and hand
         * the job back to the table graphics. If the health panel keeps
         * reporting the log as fine because the container is still findable,
         * it says everything is healthy at the exact moment the better data
         * source has been switched off — which is the failure this whole
         * chain exists to make visible.
         */
        dealerSeatKnown: state.dealerSeatIndex >= 0,
        learningEnabled: this.settings?.learningMode === 'on',
        learningLoaded: this.learningLoaded,
      }));

      // Compute equity off the page thread when workers are available.
      // This MUST use the same per-opponent read the advisor would use —
      // precomputedEquity overrides the advisor's own calculation, so
      // omitting the read here silently disables it.
      if (state.holeCards.length >= 2) {
        try {
          // No read to narrow the range with — see the engine's own note
          const rangeOpponent = undefined;
          const iters = this.settings?.mcIterations ?? 5000;
          // Same formula the postflop advisor uses, so a cached answer is
          // an answer to the question it would have asked.
          const opponents = Math.max(1, state.activePlayers - 1);
          const spec = estimateOpponentSpec(state, rangeOpponent);
          const key = equityKey(
            state.holeCards, state.communityCards, opponents, spec, iters,
          );

          const cached = this.equityCache.get(key);
          if (cached !== undefined) {
            state.precomputedEquity = cached;
          } else if (this.workerPool.isReady()) {
            const res = await this.workerPool.calculate(
              state.holeCards, [...state.communityCards], opponents, iters, spec,
            );
            state.precomputedEquity = res.equity;
            this.rememberEquity(key, res.equity);
          } else {
            /**
             * No worker — run it here so the answer gets cached.
             *
             * The advisor would otherwise run this exact Monte Carlo itself,
             * fresh on every DOM mutation, and nothing would ever populate
             * the cache. A worker that fails to start would silently restore
             * the full flicker with no other symptom. Same cost, since it is
             * the same computation either way; the difference is that this
             * one is remembered.
             */
            const res = calculateEquity(
              state.holeCards as [Card, Card],
              state.communityCards,
              opponents, iters, spec,
            );
            state.precomputedEquity = res.equity;
            this.rememberEquity(key, res.equity);
          }
        } catch {
          // Worker failed/timed out — advisors fall back to main-thread MC
        }
      }

      // Evaluate — learned params re-tune the engine's actual thresholds
      const learnedParams = this.settings?.learningMode === 'on'
        ? this.learning.getLearnedParams()
        : undefined;
      let advice = await this.engine.evaluate(state, learnedParams);

      /**
       * A refusal is not advice, and must not be dressed as any.
       *
       * The engine sets this when the table it was handed contradicts
       * itself. Everything below would otherwise treat it as a real
       * decision: learning would adjust its confidence, the panel would
       * print an action beside a CLICK badge, and the decision log would
       * record it — teaching the learning layer from a hand the extension
       * admits it could not read.
       *
       * WAIT is the honest badge here, the same as on the error path below:
       * whatever is on screen does not answer the spot in front of you.
       */
      if (advice.noAdvice) {
        this.overlay.showError(advice.reasoning.join(' '));
        this.overlay.showDecisionState(false);
        this.lastAdvice = null;
        return;
      }

      // Apply learning adjustments
      if (this.settings?.learningMode === 'on') {
        const isBluff = advice.handStrength.relative === 'air' || advice.handStrength.relative === 'weak';
        const adjustedConfidence = this.learning.applyAdjustmentToConfidence(
          advice.confidence,
          advice.action,
          isBluff,
          state.position,
          state.street,
        );

        // If confidence dropped below threshold, might change recommendation
        if (adjustedConfidence < 30 && advice.action !== 'fold' && advice.action !== 'check') {
          if (advice.alternatives.length > 0) {
            const safestAlt = advice.alternatives.find(a => a.action === 'fold' || a.action === 'check');
            if (safestAlt) {
              advice.reasoning.push(`Learning adjustment: lowered confidence from ${advice.confidence}% to ${adjustedConfidence}% — switching to safer play`);
              advice.confidence = adjustedConfidence;
              // Keep original as alternative
              advice.alternatives.unshift({
                action: advice.action,
                amount: advice.amount,
                note: `Original recommendation before learning adjustment`,
              });
              /**
               * Through the resolver, like every other action.
               *
               * This assigned the alternative straight onto the advice —
               * after `resolveAction` and `sanitizeAmount` had already run
               * inside the engine. So the last word on what to do was the one
               * step that checked nothing: it could name a button the table
               * is not showing, or pick FOLD while checking was free, which
               * is the single rule the resolver exists to enforce.
               *
               * The engine's own fuzzer cannot see this, because it calls
               * `evaluate` directly and this rewrite happens afterwards.
               */
              const resolved = resolveAction(
                safestAlt.action, safestAlt.amount, state.availableActions,
              );
              advice.action = resolved.action;
              advice.amount = resolved.amount;
            }
          }
        } else {
          advice.confidence = adjustedConfidence;
        }

        // Add learning adjustment notes
        const adjustments = this.learning.getAdjustments();
        for (const adj of adjustments) {
          if (Math.abs(adj.weight) >= 0.15) {
            advice.reasoning.push(`Learning: ${adj.description}`);
          }
        }
      }

      this.lastAdvice = advice;
      this.adviceStreet = state.street;
      this.updateBalance(state);

      // Show in overlay
      this.overlay.showAdvice(advice);
      /**
       * Re-checked, not reused.
       *
       * `yourTurn` was read before the off-thread equity await, which is the
       * whole reason this indicator exists — by the time the advice renders,
       * the turn may be over. Using the stale value would print CLICK beside
       * advice for a decision that had already been made, which is precisely
       * the failure the badge is meant to warn about.
       */
      this.overlay.showDecisionState(isYourTurn() ? true : null);

      // Record decision for learning
      if (this.settings?.learningMode === 'on') {
        const isBluff = advice.handStrength.relative === 'air' || advice.handStrength.relative === 'weak';
        const record: DecisionRecord = {
          timestamp: Date.now(),
          sessionId: this.session.sessionId,
          street: state.street,
          holeCards: state.holeCards,
          communityCards: [...state.communityCards],
          recommended: advice.action,
          recommendedAmount: advice.amount,
          confidence: advice.confidence,
          equity: advice.equity,
          potSize: state.pot,
          stackSize: state.yourStack,
          outcome: 'unknown',
          // No opponent is named: the lesson belongs to the session, not
          // to a player this build has no way to recognise again.
          opponent: undefined,
          profitLoss: 0,
          activePlayers: state.activePlayers,
          position: state.position,
          boardWetness: advice.boardTexture.wetness,
          wasBluff: isBluff,
          // The price this decision was made on, and the stakes, so learning
          // can judge a call against its price and results in blinds (L4, L6)
          priceNeeded: advice.potOdds > 0 ? advice.potOdds : undefined,
          bigBlind: trustedBigBlind(state) || undefined,
          tableSize: state.players.filter(p => p.isDealtIn ?? p.isActive).length || undefined,
          // Which hand this is, so a hand's several decisions count once (L13, L15)
          handStart: this.boundary.getHandStartTime(),
        };
        /**
         * Written only when the log accepted it as a new decision.
         *
         * This pushed on every re-evaluation, which is every DOM tick, and
         * `onHandComplete` turns the hand's slice of this array into
         * `HandRecord.actions` — so a hand that sat on screen recorded its
         * one decision over a hundred times in its own history. The same
         * repetition that inflated the decision log 11.5x.
         */
        let recorded = true;
        try {
          const db = await openDB();
          recorded = await this.learning.recordDecision(db, record);
        } catch {
          // A failed write is not a duplicate: keep the in-memory copy, as
          // this did before the log learned to skip repeats.
          recorded = true;
        }
        if (recorded) this.session.decisions.push(record);

        /**
         * Bounded, because only the current hand is ever read from here.
         *
         * `onHandComplete` filters this by `timestamp >= handStartTime`, so
         * everything older than the hand in progress is dead weight that
         * grows for as long as the session runs — each record carrying its
         * own hole and community card arrays. The durable copy lives in
         * IndexedDB and is what learning actually reads; this array only has
         * to outlive one hand.
         */
        if (this.session.decisions.length > 200) {
          this.session.decisions = this.session.decisions.slice(-100);
        }
      }

    } catch (err) {
      this.overlay.showError('Analysis error — retrying...');
      /**
       * An error is not a settled decision.
       *
       * The panel now shows an error rather than advice, so CLICK would be a
       * lie and a stale CLICK left over from the previous hand would be a
       * worse one. WAIT is the honest state here: whatever is displayed does
       * not answer the spot in front of you.
       */
      this.overlay.showDecisionState(false);
      console.error('[Poker Advisor]', err);
    } finally {
      this.evaluating = false;
      this.evaluatingSince = null;
    }
  }

  private updateBalance(state: GameState): void {
    if (!this.session) return;
    this.session.currentBalance = state.yourStack;
  }

  /**
   * Settle a finished hand.
   *
   * `prevTable` is always available; `prevState` only exists for hands we
   * were still holding cards in. Profile and learning updates run either
   * way — hands we folded are exactly the ones where watching opponents
   * matters most — and only the hand-history record needs our cards.
   */
  private async onHandComplete(
    prevTable: TableSnapshot | null,
    prevState: GameState | null,
    stackChange: number,
    handStartTime: number,
    /**
     * Whether WE re-raised their open before the flop.
     *
     * Passed in rather than read from the flow tracker, because the caller
     * resets that tracker before getting here — reading it inside would
     * silently always answer false, and the read it feeds would then look
     * measured while being uniformly empty.
     */
    /**
     * What WE did this hand, as one object.
     *
     * Previously six positional booleans, each of which had to be added to
     * two call sites by hand — and the session-stop path was missed every
     * time, so the last hand of every session under-reported our own
     * aggression. `HandFlowTracker.snapshot()` now supplies all of them.
     */
    hero: Partial<HeroHandActions> = {},
  ): Promise<void> {
    if (!this.session) return;
    const players = prevState?.players ?? prevTable?.players ?? [];
    if (players.length === 0) return;

    this.session.handsPlayed++;

    const won = stackChange > 0;

    if (won) {
      this.session.handsWon++;
      this.session.biggestWin = Math.max(this.session.biggestWin, stackChange);
    } else if (stackChange < 0) {
      this.session.handsLost++;
      this.session.biggestLoss = Math.min(this.session.biggestLoss, stackChange);
    }

    // Update learning outcomes — only for THIS hand's decisions
    if (this.settings?.learningMode === 'on' && stackChange !== 0) {
      try {
        const db = await openDB();
        const outcome = won ? 'win' as const : 'loss' as const;
        await this.learning.updateOutcome(
          db, this.session.sessionId, handStartTime, outcome, stackChange, Date.now(),
        );
        // Learning is no longer scoped to a named opponent: there is no
        // name to scope it to. One set of stats for the session.
        await this.learning.loadStats(db); // refresh stats
      } catch {}
    }

    // Record hand — only meaningful when we actually held cards
    if (prevState) {
      try {
        const handDecisions = this.session.decisions
          .filter(d => d.timestamp >= handStartTime)
          .map(d => `${d.street}: ${d.recommended}${d.recommendedAmount ? ` ${d.recommendedAmount}` : ''}`);

        // No session log on this path, so the fold comes from our own seat:
        // PokerNow marks a folded player and the reader turns that into
        // isActive=false. Undefined when the seat wasn't readable at all,
        // which is the case that genuinely stays 'unknown'.
        const heroSeat = prevState.players.find(p => p.isYou);
        const heroFolded = heroSeat ? !heroSeat.isActive : undefined;
        const record: HandRecord = {
          timestamp: Date.now(),
          holeCards: prevState.holeCards,
          communityCards: prevState.communityCards,
          result: classifyHandResult(stackChange, heroFolded),
          potWon: won ? stackChange : 0,
          net: stackChange,
          actions: handDecisions,
          tableId: this.session.gameUrl,
          players: prevState.players.map(p => p.name),
        };
        await saveHand(record);
      } catch {}
    }

    /**
     * The per-hand profile update was here, and it was the heart of the
     * tracking: for every mapped player it merged this hand's actions
     * into their stored record — VPIP, preflop raises, c-bets made and
     * folded to, bets, calls, folds, showdown cards, and the rolling
     * window of recent hands the counter-exploits read.
     *
     * Nothing is written about anyone now. The hand is still recorded
     * below for our own history and for learning, which is about our
     * decisions rather than their play.
     */
    this.saveSessionSummary(false);
    await this.persistLearningSnapshot();
  }


  /**
   * Mirror the learning state into chrome.storage.local. The decision log
   * itself lives in the page's IndexedDB, which the popup can't reach — so
   * without this cache the popup shows nothing whenever the game tab is
   * closed or in the background.
   */


  private async persistLearningSnapshot(): Promise<void> {
    try {
      const db = await openDB();
      await this.learning.loadStats(db);
      const handCount = await getHandCount();
      chrome.storage.local.set({
        learningSnapshot: this.learning.getSnapshot(),
        learningSnapshotAt: Date.now(),
        handCount,
      });
    } catch {}
  }

  private buildAdvicePayload(advice: Advice): AdvicePayload {
    const payload: AdvicePayload = {
      action: advice.action,
      amount: advice.amount,
      confidence: advice.confidence,
      equity: advice.equity,
      potOdds: advice.potOdds,
      handCategory: advice.handStrength.category,
      boardTexture: advice.boardTexture.summary,
      reasoning: advice.reasoning,
      alternatives: advice.alternatives,
      currentBalance: this.session?.currentBalance || 0,
      startingBalance: this.session?.startingBalance || 0,
      profit: (this.session?.currentBalance || 0) - (this.session?.startingBalance || 0),
      handsPlayed: this.session?.handsPlayed || 0,
      handsWon: this.session?.handsWon || 0,
    };

    if (this.settings?.learningMode === 'on') {
      // The snapshot already computes every one of these. The bluff rate was
      // hard-coded to 0.5 here, so the popup displayed "Bluff success 50%"
      // permanently — a fabricated number presented as a measurement, which
      // is worse than showing nothing.
      const snapshot = this.learning.getSnapshot();
      payload.sessionStats = {
        winRate: this.session ? (this.session.handsWon / Math.max(1, this.session.handsPlayed)) : 0,
        bluffSuccessRate: snapshot.bluffAttempts > 0 ? snapshot.bluffSuccessRate : null,
        adjustments: snapshot.adjustments
          .filter(a => Math.abs(a.weight) >= 0.15)
          .map(a => a.description),
      };
    }

    return payload;
  }
}
