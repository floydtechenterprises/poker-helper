import { Advice } from '../../engine/types';
// One shared implementation — see shared/escape.ts for why two was a bug
import { escapeHtml } from '../../shared/escape';
export { escapeHtml };

export function renderAdvice(advice: Advice): string {
  const actionClass = `action-${advice.action}`;
  const amountStr = advice.amount ? `<span class="action-amount">${formatChips(advice.amount)}</span>` : '';

  const confClass = advice.confidence >= 70 ? 'confidence-high'
    : advice.confidence >= 45 ? 'confidence-med'
      : 'confidence-low';

  const equityClass = advice.equity >= 55 ? 'equity-good'
    : advice.equity >= 35 ? 'equity-ok'
      : 'equity-bad';

  let html = '';

  // Action recommendation
  html += `
    <div class="action-box">
      <div class="action-label ${actionClass}">
        ${advice.action.toUpperCase()}${amountStr}
      </div>
      <div class="confidence-badge ${confClass}">${advice.confidence}%</div>
    </div>
  `;

  // Stats row
  html += `
    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-value">${Math.round(advice.equity)}%</div>
        <div class="stat-label">Equity</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${Math.round(advice.potOdds)}%</div>
        <div class="stat-label">Pot Odds</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${advice.confidence}%</div>
        <div class="stat-label">Confidence</div>
      </div>
    </div>
  `;

  // Equity bar
  html += `
    <div class="equity-bar-container">
      <div class="equity-bar-fill ${equityClass}" style="width: ${Math.min(100, advice.equity)}%"></div>
    </div>
  `;

  // Hand info
  html += `
    <div class="hand-info">
      <div class="hand-category">${escapeHtml(advice.handStrength.category)}</div>
      <div class="board-texture">${escapeHtml(advice.boardTexture.summary)}</div>
    </div>
  `;

  // Reasoning
  if (advice.reasoning.length > 0) {
    html += `<div class="reasoning">`;
    for (const reason of advice.reasoning) {
      html += `<div class="reasoning-item">${escapeHtml(reason)}</div>`;
    }
    html += `</div>`;
  }

  // Alternatives
  if (advice.alternatives.length > 0) {
    html += `<div class="alternatives">`;
    for (const alt of advice.alternatives) {
      const amtStr = alt.amount ? ` ${formatChips(alt.amount)}` : '';
      html += `<div class="alt-item"><span class="alt-action">${alt.action.toUpperCase()}${amtStr}</span> — ${escapeHtml(alt.note)}</div>`;
    }
    html += `</div>`;
  }

  return html;
}

export function renderWaiting(): string {
  return `<div class="waiting">Waiting for your turn<span class="waiting-dots"></span></div>`;
}

/**
 * `renderOpponentStats` was here: the "Tracked Opponents" panel.
 *
 * It listed each tracked player with a one-line summary of their VPIP,
 * aggression and fold tendencies. There is nothing to put in it now, and
 * an empty panel on screen would suggest the tracking exists but is not
 * working, which is worse than no panel at all.
 */

export function renderError(message: string): string {
  return `<div class="waiting">${escapeHtml(message)}</div>`;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toFixed(0);
}


