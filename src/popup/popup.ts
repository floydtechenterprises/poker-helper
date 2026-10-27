import { Settings, DEFAULT_SETTINGS, Message, AdvicePayload } from '../shared/messages';
import { sendToGameTab as send, GAME_URLS } from './messaging';
import { downloadJson } from '../data/hand-history';
// Escapes quotes too — this file interpolates names into ATTRIBUTES, and the
// DOM-based escape it used before left them intact
import { escapeHtml } from '../shared/escape';

let currentSettings: Settings = { ...DEFAULT_SETTINGS };
let isRunning = false;
void isRunning; // maintained for the session poller below
let pollInterval: ReturnType<typeof setInterval> | null = null;

/** Thin wrapper binding the shared sender to the real chrome API. */
function sendToGameTab(msg: Message, cb?: (response: any) => void): void {
  send(
    {
      query: (info, c) => chrome.tabs.query(info as any, c as any),
      sendMessage: (id, m, c) => chrome.tabs.sendMessage(id, m, c),
      lastError: () => chrome.runtime.lastError,
    },
    msg,
    cb,
  );
}

async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ...DEFAULT_SETTINGS }, (result) => resolve(result as unknown as Settings));
  });
}

async function saveSetting(key: keyof Settings, value: any): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [key]: value }, () => {
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' } as Message);
      resolve();
    });
  });
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }



function formatChips(n: number): string {
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

// ========================
// Game control
// ========================
/**
 * Start on whatever table is already open.
 *
 * There is nothing to fill in. The link and the starting balance were both
 * demanded because PokerNow could supply neither: a game there is a URL you
 * paste, and nothing on the page says what you sat down with. Here the tab
 * is found by origin and the stack is rendered on the felt, so the session
 * reads both rather than asking.
 */
function onStart(): void {
  startSession();
}


// ========================
// Live player mapping (during a match)
// ========================




function startSession(): void {
  /**
   * A starting balance of 0 means "read it off the table".
   *
   * The controller scrapes the stack when it starts, so a number typed here
   * could only ever disagree with the felt.
   */
  const sessionPayload = { gameUrl: '', startingBalance: 0, playerMappings: {} };

  // Kept so a table that has not finished loading still picks the session up
  chrome.storage.local.set({ pendingSession: sessionPayload });

  const msg: Message = { type: 'START_SESSION', payload: sessionPayload };

  /**
   * GAME_URLS, not a hardcoded list.
   *
   * This queried pokernow.club directly, which no amount of fixing the
   * shared constant would have helped: on duel.com it matched nothing, so
   * the message went nowhere and Start did nothing at all. There was also a
   * `tabs.create` here that opened the pasted link in a new tab — the last
   * thing you want when you are already sitting at the table.
   */
  chrome.tabs.query({ url: GAME_URLS }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg, () => {
          if (chrome.runtime.lastError) { /* tab not ready yet */ }
        });
      }
    }
  });

  setRunningState(true, 0);
}

function onStop(): void {
  chrome.storage.local.remove(['pendingSession']);

  chrome.tabs.query({ url: GAME_URLS }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'STOP_SESSION' } as Message, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
        });
      }
    }
  });

  setRunningState(false, 0);
}

function setRunningState(running: boolean, balance: number): void {
  isRunning = running;

  $('start-btn').classList.toggle('hidden', running);
  $('stop-btn').classList.toggle('hidden', !running);
  $('advice-section').classList.toggle('hidden', !running);

  // The link box was disabled while running so a session could not be
  // retargeted mid-game. There is no box now, and no link to retarget.
  $('start-hint').classList.toggle('hidden', running);

  const statusText = $('status-text');
  if (running) {
    statusText.textContent = 'Connected — analyzing...';
    statusText.classList.add('active');
    $('display-starting').textContent = formatChips(balance);
    $('display-current').textContent = formatChips(balance);
    $('display-profit').textContent = '0';
    startPolling();
  } else {
    statusText.textContent = 'Not connected';
    statusText.classList.remove('active');
    if (pollInterval) clearInterval(pollInterval);
    // Null it too, so the variable cannot claim a live timer that is gone
    pollInterval = null;
  }

}

// ========================
// Live advice polling
// ========================
function startPolling(): void {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(() => {
    sendToGameTab({ type: 'GET_SESSION_STATE' }, (response) => {
      if (response?.advice) {
        renderAdvice(response.advice as AdvicePayload);
      }
    });
  }, 1000);
}

function renderAdvice(advice: AdvicePayload): void {
  // Update balance display
  $('display-current').textContent = formatChips(advice.currentBalance);
  $('display-starting').textContent = formatChips(advice.startingBalance);

  const profitEl = $('display-profit');
  profitEl.textContent = (advice.profit >= 0 ? '+' : '') + formatChips(advice.profit);
  profitEl.className = 'balance-value ' + (advice.profit >= 0 ? 'profit-positive' : 'profit-negative');

  // Render advice box
  const box = $('advice-box');
  const confClass = advice.confidence >= 70 ? 'conf-high' : advice.confidence >= 45 ? 'conf-med' : 'conf-low';
  const amountStr = advice.amount !== undefined ? ` to ${formatChips(advice.amount)}` : '';

  let html = `
    <div class="advice-action">
      <span class="advice-action-text ${advice.action}">${advice.action.toUpperCase()}${amountStr}</span>
      <span class="advice-confidence ${confClass}">${advice.confidence}%</span>
    </div>
    <div class="advice-stats">
      <span class="advice-stat">Equity: <strong>${Math.round(advice.equity)}%</strong></span>
      <span class="advice-stat">Pot odds: <strong>${Math.round(advice.potOdds)}%</strong></span>
      <span class="advice-stat">Hands: <strong>${advice.handsPlayed}</strong></span>
    </div>
  `;

  if (advice.reasoning.length > 0) {
    html += `<div class="advice-reasoning">`;
    for (const r of advice.reasoning) {
      html += `<div class="advice-reason">${escapeHtml(r)}</div>`;
    }
    html += `</div>`;
  }

  if (advice.alternatives.length > 0) {
    html += `<div class="advice-alternatives">`;
    for (const alt of advice.alternatives) {
      const altAmt = alt.amount ? ` to ${formatChips(alt.amount)}` : '';
      html += `<div class="advice-alt"><strong>${alt.action.toUpperCase()}${altAmt}</strong> — ${escapeHtml(alt.note)}</div>`;
    }
    html += `</div>`;
  }

  box.innerHTML = html;

  // Hand info
  const handBox = $('hand-info-box');
  handBox.classList.remove('hidden');
  const eqClass = advice.equity >= 55 ? 'good' : advice.equity >= 35 ? 'ok' : 'bad';
  handBox.innerHTML = `
    <div class="hand-category">${escapeHtml(advice.handCategory)}</div>
    <div class="board-texture">${escapeHtml(advice.boardTexture)}</div>
    <div class="equity-bar">
      <div class="equity-fill ${eqClass}" style="width: ${Math.min(100, advice.equity)}%"></div>
    </div>
  `;

  // Learning stats
  if (advice.sessionStats) {
    const statsSection = $('learning-stats');
    statsSection.classList.remove('hidden');
    const grid = $('session-stats-grid');
    const adjustments = advice.sessionStats.adjustments;
    grid.innerHTML = `
      <div class="stat-item"><span>Win rate</span><strong>${Math.round(advice.sessionStats.winRate * 100)}%</strong></div>
      <div class="stat-item"><span>Bluff success</span><strong>${advice.sessionStats.bluffSuccessRate === null ? "—" : Math.round(advice.sessionStats.bluffSuccessRate * 100) + "%"}</strong></div>
      <div class="stat-item"><span>Won</span><strong>${advice.handsWon}</strong></div>
      <div class="stat-item"><span>Played</span><strong>${advice.handsPlayed}</strong></div>
      ${adjustments.map(a => `<div class="stat-item" style="grid-column: 1/-1; color: #f59e0b; font-size:10px">${escapeHtml(a)}</div>`).join('')}
    `;
  }
}

// ========================
// Player tracking
// ========================


// Which profiles the user has opened — preserved across re-renders, which
// happen twice on load (cached data, then fresh data from the game tab)








// ========================
// Session history
// ========================
interface SessionSummary {
  sessionId: string;
  gameUrl: string;
  startTime: number;
  endTime: number | null;
  startingBalance: number;
  finalBalance: number;
  profit: number;
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  biggestWin: number;
  biggestLoss: number;
}

function renderSessionHistory(): void {
  chrome.storage.local.get('sessionHistory', (result) => {
    const history = (Array.isArray(result.sessionHistory) ? result.sessionHistory : []) as SessionSummary[];
    const totalsEl = $('history-totals');
    const listEl = $('history-list');

    if (history.length === 0) {
      totalsEl.innerHTML = '';
      listEl.innerHTML = '<div class="history-empty">No sessions yet — play your first game!</div>';
      return;
    }

    const sessions = [...history].sort((a, b) => b.startTime - a.startTime);

    // Totals across all sessions
    const totalProfit = sessions.reduce((s, x) => s + x.profit, 0);
    const winningSessions = sessions.filter(x => x.profit > 0).length;

    const profitClass = totalProfit >= 0 ? 'profit-positive' : 'profit-negative';
    totalsEl.innerHTML = `
      <div class="history-total-item">
        <span class="label">All-time P/L</span>
        <span class="value ${profitClass}">${totalProfit >= 0 ? '+' : ''}${formatChips(totalProfit)}</span>
      </div>
      <div class="history-total-item">
        <span class="label">Sessions</span>
        <span class="value">${sessions.length}</span>
      </div>
      <div class="history-total-item">
        <span class="label">Winning</span>
        <span class="value">${winningSessions}/${sessions.length}</span>
      </div>
    `;

    // Scale bars against the biggest absolute result
    const maxAbs = Math.max(1, ...sessions.map(s => Math.abs(s.profit)));

    listEl.innerHTML = sessions.map(s => {
      const date = new Date(s.startTime);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const durationMin = Math.round(((s.endTime ?? Date.now()) - s.startTime) / 60000);
      const live = s.endTime === null;
      const cls = s.profit >= 0 ? 'profit-positive' : 'profit-negative';
      const barPct = Math.round((Math.abs(s.profit) / maxAbs) * 100);

      return `
        <div class="history-item" title="${escapeHtml(s.gameUrl)}">
          <div class="history-meta">
            <div class="history-date">${escapeHtml(dateStr)}${live ? ' <span class="session-live">live</span>' : ''}</div>
            <div class="history-detail">${s.handsPlayed} hands · ${s.handsWon}W/${s.handsLost}L · ${durationMin}min</div>
          </div>
          <div class="history-bar">
            <div class="history-bar-fill ${s.profit >= 0 ? 'pos' : 'neg'}" style="width:${barPct}%; ${s.profit >= 0 ? 'left:0' : 'right:0'}"></div>
          </div>
          <div class="history-profit ${cls}">${s.profit >= 0 ? '+' : ''}${formatChips(s.profit)}</div>
        </div>
      `;
    }).join('');
  });
}

// ========================
// Learning panel
// ========================
/**
 * The engine's own type, imported rather than restated.
 *
 * This was a hand-written copy of `LearningSnapshot`, structurally identical
 * at the time it was written. Adding `vsOpponent` to the real one left the
 * copy behind, and the panel could not display a field the engine was already
 * sending — the copy silently defining the popup's view of reality as an
 * older version of it. A type-only import costs nothing at runtime and cannot
 * fall out of date.
 */
import type { LearningSnapshot } from '../engine/learning';

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function progressRow(label: string, have: number, need: number): string {
  const done = have >= need;
  const width = Math.min(100, Math.round((have / need) * 100));
  return `
    <div class="learn-progress">
      <div class="learn-progress-head">
        <span>${escapeHtml(label)}</span>
        <span class="${done ? 'ready' : ''}">${have}/${need}${done ? ' ✓' : ''}</span>
      </div>
      <div class="learn-bar"><div class="learn-bar-fill ${done ? 'done' : ''}" style="width:${width}%"></div></div>
    </div>
  `;
}

// Show a learned dial only when it's actually been moved off neutral
function dialRow(label: string, value: number, lowerIsTighter: boolean): string {
  if (Math.abs(value - 1) < 0.01) return '';
  const pctChange = Math.round((value - 1) * 100);
  const tighter = lowerIsTighter ? value < 1 : value > 1;
  return `
    <div class="learn-dial">
      <span>${escapeHtml(label)}</span>
      <strong class="${tighter ? 'dial-tight' : 'dial-loose'}">${pctChange > 0 ? '+' : ''}${pctChange}%</strong>
    </div>
  `;
}

function renderLearningPanel(): void {
  // Read the cached snapshot first so the panel always has something to
  // show — the decision log itself lives in the game page's database, which
  // the popup can't reach when no PokerNow tab is open.
  chrome.storage.local.get(['learningSnapshot', 'learningSnapshotAt'], (cached) => {
    if (cached.learningSnapshot) {
      drawLearningPanel(cached.learningSnapshot as LearningSnapshot,
        cached.learningSnapshotAt as number | undefined);
    } else {
      $('learning-content').innerHTML =
        '<div class="learn-empty">No hands recorded yet.<br>Play a session with learning on and this fills in.</div>';
    }
  });

  // Then ask the live tab for fresh numbers, if one is open
  sendToGameTab({ type: 'GET_LEARNING_STATS' }, (response) => {
    if (response?.snapshot) drawLearningPanel(response.snapshot as LearningSnapshot, Date.now());
  });
}

function drawLearningPanel(s: LearningSnapshot, asOf?: number): void {
  const el = $('learning-content');
  {
    let html = `
      <div class="learn-summary">
        <div class="learn-stat"><span>Decisions</span><strong>${s.totalDecisions}</strong></div>
        <div class="learn-stat"><span>Hands graded</span><strong>${s.resolvedHands}</strong></div>
        <div class="learn-stat"><span>Win rate</span><strong>${pct(s.winRate)}</strong></div>
      </div>
    `;

    if (!s.active) {
      html += `
        <div class="learn-note">Collecting data — strategy stays at baseline until there's enough to trust.</div>
        ${progressRow('Decisions recorded', s.thresholds.decisions.have, s.thresholds.decisions.need)}
      `;
    } else {
      html += `<div class="learn-note active">Learning is active and adjusting your strategy.</div>`;
    }

    /**
     * Whose history is currently driving the strategy.
     *
     * Shown because a learning layer that silently switches which history it
     * reads is the exact shape of problem that has cost the most time here —
     * correct machinery, running or not running, with nothing on screen
     * saying which.
     */
    if (s.vsOpponent) {
      const v = s.vsOpponent;
      if (v.weight > 0) {
        html += `
          <div class="learn-note active">
            ${Math.round(v.weight * 100)}% of this strategy is learned from
            ${escapeHtml(v.name)} specifically (${v.decisions} decisions).
          </div>`;
      } else {
        html += `
          <div class="learn-note">
            Using pooled history — not enough decisions against
            ${escapeHtml(v.name)} yet to read him on his own.
          </div>
          ${progressRow(`Decisions vs ${v.name}`, v.decisions, v.need)}
        `;
      }
    }

    // Bluffing
    html += `<h3 class="learn-h3">Bluffing</h3>`;
    if (s.bluffAttempts >= s.thresholds.bluffs.need) {
      html += `
        <div class="learn-grid">
          <div class="learn-stat"><span>Overall</span><strong>${pct(s.bluffSuccessRate)}</strong></div>
          <div class="learn-stat"><span>Flop</span><strong>${pct(s.bluffByStreet.flop)}</strong><em class="pstat-was">${s.bluffAttemptsByStreet?.flop ?? 0} tries</em></div>
          <div class="learn-stat"><span>Turn</span><strong>${pct(s.bluffByStreet.turn)}</strong><em class="pstat-was">${s.bluffAttemptsByStreet?.turn ?? 0} tries</em></div>
          <div class="learn-stat"><span>River</span><strong>${pct(s.bluffByStreet.river)}</strong><em class="pstat-was">${s.bluffAttemptsByStreet?.river ?? 0} tries</em></div>
        </div>
      `;
    } else {
      html += progressRow('Bluffs attempted', s.thresholds.bluffs.have, s.thresholds.bluffs.need);
    }

    // Calling discipline
    html += `<h3 class="learn-h3">Calling discipline</h3>`;
    if (s.callsTracked >= s.thresholds.calls.need) {
      html += `
        <div class="learn-grid">
          <div class="learn-stat"><span>Calls tracked</span><strong>${s.callsTracked}</strong></div>
          <div class="learn-stat"><span>Bad calls</span><strong>${pct(s.badCallRate)}</strong></div>
        </div>
        <div class="learn-sub">"Bad" = lost with equity below the price. Coolers don't count.</div>
      `;
    } else {
      html += progressRow('Calls tracked', s.thresholds.calls.have, s.thresholds.calls.need);
    }

    // Which dials are currently turned
    const dials = [
      dialRow('Bluff frequency', s.params.bluffScale, true),
      dialRow('River bluffs', s.params.riverBluffScale, true),
      dialRow('Call price demanded', s.params.callMargin, false),
      dialRow('Thin value bets', s.params.thinValueScale, true),
      dialRow('Blind tightness', s.params.blindTightness, false),
    ].filter(Boolean).join('');

    html += `<h3 class="learn-h3">Strategy dials</h3>`;
    html += dials
      ? `<div class="learn-dials">${dials}</div>`
      : `<div class="learn-sub">All neutral — no leaks detected yet.</div>`;

    if (s.adjustments.length > 0) {
      html += `<h3 class="learn-h3">Active adjustments</h3><div class="learn-adjustments">`;
      for (const a of s.adjustments) {
        html += `<div class="learn-adjustment">${escapeHtml(a.description)}</div>`;
      }
      html += `</div>`;
    }

    if (asOf) {
      const mins = Math.round((Date.now() - asOf) / 60000);
      const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
      html += `<div class="learn-asof">Updated ${when}</div>`;
    }

    el.innerHTML = html;
  }
}

// ========================
// Self-check: is the learning actually being applied?
// ========================
interface SelfCheckResult {
  id: string; dial: string; dialValue: number; label: string; spot: string;
  baseline: { action: string; amount?: number; confidence: number };
  withLearning: { action: string; amount?: number; confidence: number };
  changed: boolean; note?: string;
}

function describeAdvice(a: { action: string; amount?: number }): string {
  return a.amount !== undefined
    ? `${a.action.toUpperCase()} ${formatChips(a.amount)}`
    : a.action.toUpperCase();
}

function runSelfCheck(): void {
  const el = $('self-check-results');
  el.innerHTML = '<div class="learn-empty">Running…</div>';

  let answered = false;
  sendToGameTab({ type: 'RUN_SELF_CHECK' }, (response) => {
    answered = true;
    const results: SelfCheckResult[] | null = response?.results || null;
    if (!results) {
      el.innerHTML = '<div class="learn-empty">Could not run — is the game page loaded?</div>';
      return;
    }

    const changedCount = results.filter(r => r.changed).length;
    const movedDials = results.filter(r => Math.abs(r.dialValue - 1) >= 0.01);

    let html = `<div class="check-head">`;
    if (movedDials.length === 0) {
      /**
       * Say WHY it is neutral, not just that it is.
       *
       * "Nothing has been learned yet" is true whether the engine has
       * recorded ten thousand decisions and found no leak, or has recorded
       * none at all because learning never ran. Those are opposite states
       * with opposite fixes, and the panel reported them identically — the
       * same ambiguity that sent four attempts at the log banner to the wrong
       * target.
       */
      const snap = response?.snapshot;
      const have = snap?.thresholds?.decisions?.have ?? 0;
      const need = snap?.thresholds?.decisions?.need ?? 0;
      const graded = snap?.resolvedHands ?? 0;
      if (have === 0) {
        html += `<strong class="check-no">No decisions recorded at all.</strong> `
          + `Learning cannot run — check that Learning is set to "on" in Settings, `
          + `and that a session is actually started.`;
      } else if (have < need) {
        html += `Every dial is still neutral — <strong>${have} of ${need}</strong> `
          + `decisions recorded (${graded} hands graded). Nothing is applied until `
          + `there is enough to trust.`;
      } else {
        html += `Every dial is neutral, and that is a real result: `
          + `<strong>${have}</strong> decisions recorded, ${graded} hands graded, `
          + `and no leak has crossed its threshold. Advice is unchanged by design.`;
      }
    } else if (changedCount > 0) {
      html += `<strong class="check-yes">${changedCount} of ${results.length} decisions change</strong> because of what it learned from your games.`;
    } else {
      html += `${movedDials.length} dial(s) have moved, but none of these test spots flipped — the changes are there but not large enough to alter these particular decisions.`;
    }
    html += `</div>`;

    for (const r of results) {
      const same = !r.changed;
      html += `
        <div class="check-row ${same ? 'check-same' : 'check-diff'}">
          <div class="check-label">
            ${escapeHtml(r.label)}
            <span class="check-dial">${escapeHtml(r.dial)} ${r.dialValue.toFixed(2)}</span>
          </div>
          <div class="check-spot">${escapeHtml(r.spot)}</div>
          <div class="check-compare">
            <span class="check-before">${escapeHtml(describeAdvice(r.baseline))}</span>
            <span class="check-arrow">${same ? '=' : '→'}</span>
            <span class="check-after">${escapeHtml(describeAdvice(r.withLearning))}</span>
          </div>
          ${r.note ? `<div class="check-note">${escapeHtml(r.note)}</div>` : ''}
        </div>
      `;
    }

    html += `<div class="check-foot">Each spot is run twice — identical cards, identical equity — once with neutral settings and once with what it has actually learned from your play. Any difference is caused by learning alone.</div>`;
    el.innerHTML = html;
  });

  setTimeout(() => {
    if (!answered) {
      el.innerHTML = '<div class="learn-empty">Open your PokerNow tab — the check runs on the game page.</div>';
    }
  }, 2500);
}

// ========================
// Table read check (scraper diagnostics)
// ========================
function runTableRead(): void {
  const el = $('diag-results');
  el.innerHTML = '<div class="learn-empty">Reading…</div>';

  let answered = false;
  sendToGameTab({ type: 'GET_SCRAPER_DEBUG' }, (r) => {
    answered = true;
    if (!r) {
      el.innerHTML = '<div class="learn-empty">No response — is the PokerNow tab open?</div>';
      return;
    }

    const s = r.state;
    const rows: string[] = [];
    const row = (k: string, v: string, bad = false) =>
      `<div class="diag-row"><span>${escapeHtml(k)}</span><strong class="${bad ? 'diag-bad' : ''}">${escapeHtml(v)}</strong></div>`;

    if (!s) {
      rows.push(row('Your cards', 'not visible (not in a hand?)', true));
    } else {
      rows.push(row('Your cards', s.holeCards.join(' ')));
      rows.push(row('Board', s.communityCards.length ? s.communityCards.join(' ') : '(preflop)'));
      rows.push(row('Street', s.street));
      rows.push(row('Pot', String(s.pot), s.pot <= 0));
      rows.push(row('Your stack', String(s.yourStack), s.yourStack <= 0));
      rows.push(row('To call', String(s.costToCall)));
      rows.push(row('Blinds', `${s.smallBlind}/${s.bigBlind}`, s.bigBlind <= 0));
      rows.push(row('Your position', s.position));
      rows.push(row('Players in hand', String(s.activePlayers), s.activePlayers < 2));
      rows.push(row('You raised preflop', s.heroIsPreflopAggressor ? 'yes' : 'no'));
    }

    rows.push(row('Your turn', r.yourTurn ? 'yes' : 'no'));
    rows.push(row('Buttons seen', r.availableActions.length ? r.availableActions.join(', ') : 'none'));

    // The session log is the reliable source — flag loudly if it's missing
    const log = r.log || {};
    rows.push(row('Session log', log.found ? 'found ✓' : 'NOT FOUND', !log.found));
    // PokerNow's log endpoint needs no panel open; the panel is the fallback
    if (log.source) {
      rows.push(row('Log source',
        log.source === 'endpoint' ? 'PokerNow log (no panel needed)'
          : log.source === 'waiting' ? 'asking PokerNow…'
            : 'LOG panel (fetch failed)',
        log.source === 'panel'));
      // What the request actually did: a refusal, a rate limit and a blocked
      // request are indistinguishable from "it stopped answering"
      if (log.endpointStatus) rows.push(row('Log fetches', String(log.endpointStatus)));
    }
    if (log.found) {
      /**
       * Found is not the same as working.
       *
       * A container that yields nothing parseable used to report itself
       * found, and because the controller defers to the log whenever it is
       * available, that silently switched off ALL recording. These two rows
       * are the difference between a reader that is doing its job and one
       * that only looks like it.
       */
      rows.push(row('Log lines visible', String(log.linesVisible ?? 0),
        (log.linesVisible ?? 0) < 2));
      rows.push(row('Hands read from log', String(log.handsParsed ?? 0)));
      if (log.abandoned) {
        rows.push(row('Log status',
          'abandoned — using table graphics instead', true));
      }
      rows.push(row('Dealer (from log)', log.dealer || '—'));
      rows.push(row('Street (from log)', log.street || '—'));
    }

    let html = `<div class="diag-grid">${rows.join('')}</div>`;

    // Tracking status — why a profile is or isn't filling up
    const tr = r.tracking;
    if (tr) {
      html += `<div class="diag-sub">Tracking</div><div class="diag-grid">`;
      html += row('Session running', tr.sessionRunning ? 'yes' : 'NO — press Start game', !tr.sessionRunning);
      html += row('Hands recorded', String(tr.handsThisSession), tr.handsThisSession === 0);
      if (tr.matches.length === 0) {
        html += row('Mapped friends', 'none mapped', true);
      } else {
        for (const m of tr.matches) {
          html += row(
            `${m.tracked} → ${m.ingame}`,
            m.matchedSeat ? 'matched a seat ✓' : 'NO SEAT MATCHES',
            !m.matchedSeat,
          );
        }
      }
      html += `</div>`;
    }

    if (log.recent?.length) {
      html += `<div class="diag-sub">Last log lines</div><div class="diag-log">` +
        log.recent.map((l: string) => `<div>${escapeHtml(l)}</div>`).join('') +
        `</div>`;
    }

    if (r.seats?.length) {
      html += `<div class="diag-sub">Seats detected</div><div class="diag-grid">`;
      for (const p of r.seats) {
        const tracked = Object.entries(r.mappings || {}).find(([, ingame]) => ingame === p.name);
        const label = `${p.name}${p.you ? ' (you)' : ''}${tracked ? ` → tracked as ${tracked[0]}` : ''}`;
        html += `<div class="diag-row"><span>${escapeHtml(label)}</span><strong class="${p.active ? '' : 'diag-dim'}">${p.stack}${p.bet ? ` · bet ${p.bet}` : ''}${p.active ? '' : ' · out'}</strong></div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="learn-empty">No player seats detected — that's a scraper problem.</div>`;
    }

    html += `<div class="check-foot">Compare these against your actual table. Anything wrong here means the advice is being computed from bad data.</div>`;
    el.innerHTML = html;
  });

  setTimeout(() => {
    if (!answered) {
      el.innerHTML = '<div class="learn-empty">No response — open your PokerNow game tab and try again.</div>';
    }
  }, 2500);
}

function resetLearning(): void {
  if (!confirm('Erase all learning data? Opponent profiles and session history are kept.')) return;

  let answered = false;
  sendToGameTab({ type: 'RESET_LEARNING' }, (response) => {
    answered = true;
    if (response?.ok) {
      chrome.storage.local.remove(['learningSnapshot', 'learningSnapshotAt']);
      $('learning-content').innerHTML = '<div class="learn-empty">Learning data cleared — starting fresh.</div>';
    }
  });

  // The decision log lives in the game page, so clearing needs an open tab
  setTimeout(() => {
    if (!answered) {
      $('learning-content').innerHTML =
        '<div class="learn-empty">Open your PokerNow tab first — the learning data lives on the game page.</div>';
    }
  }, 1200);
}

// ========================
// Collapsible sections
// ========================
function setupToggle(toggleId: string, bodyId: string): void {
  const toggle = $(toggleId);
  const body = $(bodyId);
  const arrow = toggle.querySelector('.toggle-arrow') as HTMLElement;

  toggle.addEventListener('click', () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    arrow.classList.toggle('collapsed', !hidden);
  });
}

// ========================
// Init
// ========================
async function init(): Promise<void> {
  currentSettings = await loadSettings();

  // Game control
  $('start-btn').addEventListener('click', onStart);
  $('stop-btn').addEventListener('click', onStop);

  // MC iterations
  const mcSelect = $('mc-iterations') as HTMLSelectElement;
  mcSelect.value = String(currentSettings.mcIterations);
  mcSelect.addEventListener('change', () => saveSetting('mcIterations', parseInt(mcSelect.value)));

  // Learning mode
  const learningSelect = $('learning-mode') as HTMLSelectElement;
  learningSelect.value = currentSettings.learningMode;
  learningSelect.addEventListener('change', () => saveSetting('learningMode', learningSelect.value));

  // Hand count — cached value first, then refresh from a live tab if there is one
  chrome.storage.local.get('handCount', (cached) => {
    if (typeof cached.handCount === 'number') {
      $('hand-count').textContent = String(cached.handCount);
    }
  });
  sendToGameTab({ type: 'GET_HAND_COUNT' }, (response) => {
    if (response?.count !== undefined) {
      $('hand-count').textContent = String(response.count);
      chrome.storage.local.set({ handCount: response.count });
    }
  });

  /**
   * Export.
   *
   * This used chrome.tabs.query({active, currentWindow}) — the same wrong-tab
   * bug already fixed everywhere else — and passed no callback, so every
   * failure was swallowed. Clicking it did nothing, said nothing, and left
   * no way to tell a broken export from a working one.
   */
  $('export-btn').addEventListener('click', () => {
    const btn = $('export-btn') as HTMLButtonElement;
    // Fixed text, NOT whatever the button currently says. Reading it live
    // meant a second click during the 3s "Saved to Downloads" window
    // captured that as the label and restored it forever.
    const label = 'Export hand history';
    btn.disabled = true;
    btn.textContent = 'Exporting…';

    const finish = (msg: string, revertMs: number) => {
      btn.textContent = msg;
      btn.disabled = false;
      setTimeout(() => { btn.textContent = label; }, revertMs);
    };

    sendToGameTab({ type: 'EXPORT_HAND_HISTORY' }, (res) => {
      if (!res) {
        finish('No PokerNow tab found — open your game and retry', 5000);
        return;
      }
      if (!res.ok || typeof res.json !== 'string') {
        finish(`Export failed${res.error ? `: ${res.error}` : ''}`, 5000);
        return;
      }
      downloadJson(res.json, `poker-history-${Date.now()}.json`);
      finish('Saved to Downloads', 3000);
    });
  });


  /*
   * Backup save/load lived here, wired to buttons that no longer exist.
   *
   * Deleting the markup without these left the lookup returning null and
   * addEventListener throwing during init — which does not break one
   * feature, it breaks the whole popup, Start button included. The backup
   * format was a profile format and went with the profiles.
   */

  // Collapsible sections
  setupToggle('settings-toggle', 'settings-body');
  setupToggle('history-toggle', 'history-body');

  // Session history (refresh when the section is opened, too)
  renderSessionHistory();
  $('history-toggle').addEventListener('click', renderSessionHistory);

  // Learning panel
  setupToggle('learning-toggle', 'learning-body');
  $('learning-toggle').addEventListener('click', renderLearningPanel);
  $('reset-learning-btn').addEventListener('click', resetLearning);
  $('self-check-btn').addEventListener('click', runSelfCheck);

  // Table read check
  setupToggle('diag-toggle', 'diag-body');
  $('diag-refresh-btn').addEventListener('click', runTableRead);

  // Pick up a session that is already running on the open table
  sendToGameTab({ type: 'GET_SESSION_STATE' }, (response) => {
    if (response?.isRunning) {
      setRunningState(true, response.startingBalance || 0);
      if (response.advice) renderAdvice(response.advice);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
