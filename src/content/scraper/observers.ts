import { SEL } from './selectors';
import { DEBOUNCE_MS } from '../../shared/constants';

export type GameEvent = 'turn' | 'cards' | 'state-change';

export class GameObserver {
  private observers: MutationObserver[] = [];
  private callback: ((event: GameEvent) => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  start(callback: (event: GameEvent) => void): void {
    this.callback = callback;
    this.observeDecisions();
    this.observeCards();
    this.observeTable();
  }

  stop(): void {
    for (const obs of this.observers) obs.disconnect();
    this.observers = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    // Otherwise a restarted observer inherits the previous session's pending
    // event and delivers it as though it had just happened
    this.pending = null;
    this.callback = null;
  }

  /**
   * Which event wins when several land inside one debounce window.
   *
   * All three observers share a single timer, so the type delivered used to
   * be simply whichever fired LAST — and the table observer fires
   * 'state-change' on every mutation, including the animations that
   * accompany buttons appearing. A 'turn' was therefore routinely overwritten
   * by a 'state-change' that arrived a few milliseconds later.
   *
   * That is not cosmetic: the controller skips analysis entirely for
   * 'state-change' when it does not currently read as our turn, so the one
   * event meaning "you have to act" could be replaced by the one event that
   * is allowed to do nothing.
   *
   * Higher wins.
   */
  private static readonly PRIORITY: Record<GameEvent, number> = {
    turn: 3,
    cards: 2,
    'state-change': 1,
  };

  private pending: GameEvent | null = null;

  private fire(event: GameEvent): void {
    // Keep the most significant event seen in this window, not the newest
    if (this.pending === null
        || GameObserver.PRIORITY[event] > GameObserver.PRIORITY[this.pending]) {
      this.pending = event;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const toDeliver = this.pending;
      this.pending = null;
      if (toDeliver) this.callback?.(toDeliver);
    }, DEBOUNCE_MS);
  }

  /**
   * Is this mutation about the action buttons at all?
   *
   * On PokerNow the buttons are always in the DOM and merely disabled, so
   * anything happening under the actions container was news and this
   * question did not need asking. Here the container is ABSENT whenever it
   * is not our turn, which broke the observer twice over: `querySelector`
   * at start-up found nothing and fell back to `document.body`, and every
   * mutation on the page — chips sliding into the pot, a seat re-rendering,
   * the blind-up clock ticking — was then delivered as 'turn', which
   * outranks every other event in the debounce.
   *
   * Watching the whole shell is still right, because the thing worth
   * watching does not exist yet when watching starts. What was missing is
   * this predicate.
   */
  private static touchesActions(m: MutationRecord): boolean {
    const WANTED = `${SEL.ACTIONS}, ${SEL.BTN}`;
    const nodes: Node[] = [
      m.target,
      ...Array.from(m.addedNodes),
      ...Array.from(m.removedNodes),
    ];

    for (const n of nodes) {
      // 1 is Node.ELEMENT_NODE; `Node` is not reliably global under jsdom
      const el = (n.nodeType === 1 ? n : n.parentElement) as Element | null;
      if (!el) continue;
      // `closest` catches the buttons themselves and anything inside them;
      // `querySelector` catches a wrapper that arrives with the panel in it
      if (el.closest(WANTED) || el.querySelector(WANTED)) return true;
    }
    return false;
  }

  private observeDecisions(): void {
    /**
     * A root that will still be here later.
     *
     * The actions container comes and goes with our turn, so resolving it
     * once at start-up and watching that is watching nothing for most of the
     * session. The shell outlives every hand.
     */
    const target = document.querySelector(SEL.GAME_SHELL)
      || document.querySelector(SEL.PLAY_SURFACE)
      || document.body;

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList' && m.type !== 'attributes') continue;
        if (m.type === 'childList'
            && m.addedNodes.length === 0 && m.removedNodes.length === 0) continue;
        // Removals count too: the buttons going away ends our turn, and the
        // controller repaints to the waiting state on that edge
        if (!GameObserver.touchesActions(m)) continue;
        this.fire('turn');
        return;
      }
    });

    obs.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    this.observers.push(obs);
  }

  private observeCards(): void {
    // Watch community cards area
    const tableCards = document.querySelector(SEL.BOARD);
    if (tableCards) {
      const obs = new MutationObserver(() => this.fire('cards'));
      obs.observe(tableCards, { childList: true, subtree: true });
      this.observers.push(obs);
    }

    // Watch your cards area for flipped class (cards revealed)
    const youPlayer = document.querySelector(SEL.SEAT_SELF);
    if (youPlayer) {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            const target = m.target as Element;
            if (target.classList.contains('card') || target.closest('.card')) {
              this.fire('cards');
              return;
            }
          }
          if (m.type === 'childList') {
            this.fire('cards');
            return;
          }
        }
      });
      obs.observe(youPlayer, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class'],
      });
      this.observers.push(obs);
    }
  }

  private observeTable(): void {
    // General table state changes (pot updates, player actions)
    const table = document.querySelector(SEL.TABLE);
    if (table) {
      const obs = new MutationObserver(() => this.fire('state-change'));
      obs.observe(table, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      this.observers.push(obs);
    }
  }
}
