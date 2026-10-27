import { Advice } from '../../engine/types';
import { OVERLAY_STYLES } from './styles';
import { makeDraggable } from './draggable';
import { makeResizable, MIN_WIDTH, MIN_HEIGHT } from './resizable';
import { renderAdvice, renderWaiting, renderError, escapeHtml } from './components';
import { HealthIssue, healthLevel } from '../health';
import { OVERLAY_DEFAULT_X, OVERLAY_DEFAULT_Y } from '../../shared/constants';
import { saveSettings } from '../../data/settings';

/**
 * How slow a recompute has to be before the badge says WAIT.
 *
 * Below this the answer arrives faster than you could act on it, so warning
 * about it is pure noise — and noise is what made the first version strobe
 * continuously during a turn. Above it, the panel really is showing a stale
 * decision for long enough that you could press the key on it.
 *
 * 180ms is roughly the floor of deliberate human reaction, so a recompute
 * that beats it cannot have caught you mid-keypress.
 */
const SLOW_DECISION_MS = 180;

export class OverlayUI {
  /** Pending WAIT, if a recompute is running but not yet slow enough to show. */
  private decisionStateTimer: ReturnType<typeof setTimeout> | null = null;

  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private panel: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private healthEl: HTMLElement | null = null;
  private collapsed = false;
  /**
   * Undo the document-level drag and resize listeners.
   *
   * They are attached to `document`, so removing the host element does not
   * remove them: every stop/start of a session left another pair behind,
   * holding a detached panel that could never be collected and running on
   * every mouse movement for the life of the tab. Invisible, because their
   * drag flags are false — which is exactly why it accumulated.
   */
  private teardown: (() => void)[] = [];

  create(
    x: number = OVERLAY_DEFAULT_X,
    y: number = OVERLAY_DEFAULT_Y,
    collapsed = false,
    width = 0,
    height = 0,
  ): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.id = 'poker-advisor-root';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.shadow.appendChild(style);

    this.panel = document.createElement('div');
    this.panel.className = 'advisor-panel';
    this.panel.style.left = `${x}px`;
    this.panel.style.top = `${y}px`;

    // A saved size only exists once the user has actually resized. Until
    // then the panel keeps sizing itself to the advice, which is what you
    // want for a box whose content changes every street.
    if (width >= MIN_WIDTH) this.panel.style.width = `${width}px`;
    if (height >= MIN_HEIGHT) {
      this.panel.style.height = `${height}px`;
      // A fixed height means the body must scroll instead of the panel
      // clipping — the 500px cap would otherwise fight the chosen size
      this.panel.style.setProperty('--body-max-height', 'none');
    }

    // Header
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <span class="header-title">Poker Advisor</span>
      <span class="health-dot health-ok" title="Reading the table correctly"></span>
      <span class="decision-state ready" title="The advice below is settled">CLICK</span>
      <div class="header-controls">
        <button class="header-btn collapse-btn" title="Minimize">${collapsed ? '+' : '−'}</button>
        <button class="header-btn close-btn" title="Close overlay">×</button>
      </div>
    `;
    this.panel.appendChild(header);

    // Health banner lives OUTSIDE the body.
    //
    // It used to be prepended into the body, where the very next
    // `showAdvice()` call replaced innerHTML and destroyed it — so the
    // warning that the table is being misread was never once visible.
    // Its own element makes that impossible rather than relying on
    // whoever writes the body remembering it exists.
    this.healthEl = document.createElement('div');
    this.healthEl.className = 'health-slot';
    this.panel.appendChild(this.healthEl);

    // Body
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'body';
    this.bodyEl.innerHTML = renderWaiting();
    this.panel.appendChild(this.bodyEl);

    this.collapsed = collapsed;
    if (collapsed) {
      this.panel.classList.add('collapsed');
      this.bodyEl.style.display = 'none';
    }

    this.shadow.appendChild(this.panel);
    document.body.appendChild(this.host);

    // Draggable by the header, resizable from any edge or corner
    this.teardown.push(makeDraggable(this.panel, header));
    this.teardown.push(makeResizable(this.panel));

    // Collapse toggle
    const collapseBtn = header.querySelector('.collapse-btn') as HTMLButtonElement;
    collapseBtn.addEventListener('click', () => this.toggleCollapse());

    // Close button
    const closeBtn = header.querySelector('.close-btn') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.hide());
  }

  /**
   * Surface data-quality problems next to the advice.
   *
   * Advice computed from a misread table is confidently wrong, which is
   * worse than no advice — so a broken read banners itself above the
   * recommendation rather than sitting quietly in a tooltip.
   */
  /**
   * Whether the advice on screen is settled or still being worked out.
   *
   * The engine awaits an off-thread equity calculation before it renders, so
   * during that window the PREVIOUS decision is still displayed — correct
   * looking, confidently formatted, and about to be replaced. Acting on it
   * with the hotkey is how you press check a moment before the panel changes
   * its mind, which is exactly what happened in play.
   *
   * The panel cannot make the computation faster, but it can stop pretending
   * to be finished while it is not.
   */
  showDecisionState(settled: boolean | null): void {
    if (!this.panel) return;
    const el = this.panel.querySelector('.decision-state') as HTMLElement | null;
    if (!el) return;

    /**
     * WAIT is delayed; CLICK and hidden are immediate.
     *
     * The engine re-evaluates on every DOM mutation, and PokerNow re-renders
     * constantly during a turn — timers, chip animations, seat updates. Almost
     * all of those recomputes hit the equity cache and finish in a couple of
     * milliseconds, so showing WAIT the instant one starts made the badge
     * strobe between the two states the entire time it was your turn. It was
     * reported from live play as flickering "the whole time", which is worse
     * than useless: a warning that fires constantly is one you stop reading,
     * and this one exists precisely to be read in the instant before a
     * keypress.
     *
     * So a recompute has to be genuinely slow before it says anything. If it
     * finishes inside the delay the badge never leaves CLICK, because nothing
     * worth warning about happened.
     */
    if (this.decisionStateTimer !== null) {
      clearTimeout(this.decisionStateTimer);
      this.decisionStateTimer = null;
    }

    if (settled === false) {
      this.decisionStateTimer = setTimeout(() => {
        this.decisionStateTimer = null;
        this.applyDecisionState(el, false);
      }, SLOW_DECISION_MS);
      return;
    }

    this.applyDecisionState(el, settled);
  }

  /** Paints the badge. Split out so the delay above has something to call. */
  private applyDecisionState(el: HTMLElement, settled: boolean | null): void {

    /**
     * Hidden when it is not our turn.
     *
     * The engine re-evaluates on every DOM mutation, so a permanently visible
     * indicator would blink between the two states throughout the opponent's
     * turn — motion in the corner of the eye that means nothing, at the exact
     * moment there is nothing to decide. It only earns its place while a
     * decision is actually in front of you.
     */
    if (settled === null) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';

    /**
     * WAIT means "do not act on what is displayed" — which covers both
     * still-computing and an error, since in both cases the panel is showing
     * something that does not answer the current spot. CLICK is the only
     * state that claims the advice below is settled and current.
     */
    el.textContent = settled ? 'CLICK' : 'WAIT';
    el.className = `decision-state ${settled ? 'ready' : 'thinking'}`;
    el.title = settled
      ? 'The advice below is settled — safe to act on'
      : 'Still working this decision out — what you see may change';
  }

  showHealth(issues: HealthIssue[]): void {
    if (!this.panel) return;
    const dot = this.panel.querySelector('.health-dot') as HTMLElement | null;
    const level = healthLevel(issues);

    if (dot) {
      dot.className = `health-dot health-${level === 'ok' ? 'ok' : level === 'degraded' ? 'warn' : 'bad'}`;
      dot.title = issues.length
        ? issues.map(i => `${i.severity === 'error' ? '✗' : '!'} ${i.message}`).join('\n')
        : 'Reading the table correctly';
    }

    /**
     * Say WHY, not just that something is wrong.
     *
     * Only errors used to draw a banner; a warning turned the dot amber and
     * hid its reason in a tooltip. An indicator that reports a problem but
     * not which problem is barely better than no indicator — you cannot act
     * on "something is off", and nobody thinks to hover a dot.
     *
     * Errors and warnings mean different things, so they read differently:
     * an error says the advice may be wrong, a warning says it is working
     * but something is worth knowing.
     */
    if (!this.healthEl) return;
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    if (errors.length === 0 && warnings.length === 0) {
      this.healthEl.innerHTML = '';
      return;
    }

    const shown = errors.length > 0 ? errors : warnings;
    const isError = errors.length > 0;
    this.healthEl.innerHTML = `
      <div class="health-banner${isError ? '' : ' health-banner-warn'}">
        <strong>${isError
          ? "Advice may be wrong — the table isn't being read correctly"
          : 'Working, but worth knowing'}</strong>
        ${shown.map(e => `<span>${escapeHtml(e.message)}${e.fix ? ` — ${escapeHtml(e.fix)}` : ''}</span>`).join('')}
      </div>
    `;
  }

  hide(): void {
    if (this.host) this.host.style.display = 'none';
  }

  show(): void {
    if (this.host) this.host.style.display = '';
  }

  destroy(): void {
    // A pending WAIT must not fire into a panel that no longer exists
    if (this.decisionStateTimer !== null) {
      clearTimeout(this.decisionStateTimer);
      this.decisionStateTimer = null;
    }
    for (const undo of this.teardown) undo();
    this.teardown = [];
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.panel = null;
      this.bodyEl = null;
      this.healthEl = null;
    }
  }

  showAdvice(advice: Advice): void {
    if (!this.bodyEl) return;
    // Just the advice. The tracked-opponent panel went with the profiles.
    const html = renderAdvice(advice);
    this.bodyEl.innerHTML = html;
  }

  /**
   * Back to waiting — and the last health banner goes with it.
   *
   * Health is only recomputed when advice is, so a warning raised in the
   * instant a hand ended stayed on screen indefinitely: the panel read
   * "Waiting for your turn" underneath a banner insisting it WAS our turn.
   * A banner describing a moment that has passed is just wrong.
   */
  showWaiting(): void {
    if (this.healthEl) this.healthEl.innerHTML = '';
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = renderWaiting();
  }

  showError(message: string): void {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = renderError(message);
  }

  /**
   * Confirm what the hotkey just did — or why it did nothing.
   *
   * A key that silently does nothing is worse than no key: you cannot tell a
   * refused press from a missed one, and under a two-minute blind level you
   * will press it again rather than look. This overwrites nothing permanent
   * and fades on its own.
   */
  flashHotkeyResult(message: string): void {
    if (!this.panel) return;
    const existing = this.panel.querySelector('.hotkey-flash');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'hotkey-flash';
    el.textContent = message;
    this.panel.appendChild(el);

    setTimeout(() => el.remove(), 1800);
  }

  private toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    if (!this.panel || !this.bodyEl) return;

    if (this.collapsed) {
      this.panel.classList.add('collapsed');
      this.bodyEl.style.display = 'none';
      if (this.healthEl) this.healthEl.style.display = 'none';
    } else {
      this.panel.classList.remove('collapsed');
      this.bodyEl.style.display = '';
      if (this.healthEl) this.healthEl.style.display = '';
    }

    const btn = this.panel.querySelector('.collapse-btn');
    if (btn) btn.textContent = this.collapsed ? '+' : '−';

    /**
     * Remember it, like position and size already are.
     *
     * `collapsed` is a real setting: it has a default, it is loaded, and
     * `create()` takes it as an argument to restore the panel minimised.
     * Nothing ever wrote it. So the whole mechanism existed and did nothing —
     * you minimised the overlay, reloaded, and it came back open, with the
     * code reading as though that were handled.
     */
    saveSettings({ collapsed: this.collapsed });
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }
}
