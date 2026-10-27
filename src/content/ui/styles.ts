export const OVERLAY_STYLES = `
/* Health indicator: a misread table must be visible, not silent */
/*
 * Whether the advice below is settled.
 *
 * Sits beside the health dot because it answers the same kind of question —
 * can I trust what I am looking at right now — and because that is where the
 * eye already goes before acting. Deliberately small and flat: it must be
 * readable in the instant before a keypress without competing with the
 * action it is qualifying.
 */
.decision-state {
  margin-left: 7px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: help;
  flex-shrink: 0;
}
.decision-state.ready {
  background: rgba(34,197,94,0.16);
  color: #22c55e;
}
/*
 * The amber pulses. A static badge is easy to look straight past when you
 * have already decided to press the key — the movement is the point, and it
 * stops the moment the advice settles.
 */
.decision-state.thinking {
  background: rgba(245,158,11,0.18);
  color: #f59e0b;
  animation: decisionPulse 0.7s ease-in-out infinite;
}
@keyframes decisionPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 7px;
  flex-shrink: 0;
  cursor: help;
}
.health-ok { background: #22c55e; }
.health-warn { background: #f59e0b; }
.health-bad {
  background: #ef4444;
  animation: healthPulse 1.2s ease-in-out infinite;
}
@keyframes healthPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.health-slot:empty { display: none; }

.health-banner {
  margin: 0 12px;
  background: rgba(239, 68, 68, 0.14);
  border-left: 3px solid #ef4444;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.health-banner strong {
  font-size: 11px;
  color: #fca5a5;
  line-height: 1.35;
}
.health-banner span {
  font-size: 10px;
  color: #e0a0a0;
  line-height: 1.35;
}

/* A warning is not an error: the advice is still usable, so it must not
   look like the same alarm */
.health-banner-warn {
  background: rgba(234, 179, 8, 0.12);
  border-left-color: #eab308;
}
.hotkey-flash {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 10px;
    padding: 7px 10px;
    border-radius: 6px;
    background: rgba(74, 222, 128, 0.16);
    border: 1px solid rgba(74, 222, 128, 0.4);
    color: #b7f0cd;
    font-size: 11px;
    text-align: center;
    pointer-events: none;
    z-index: 4;
  }

  .health-banner-warn strong { color: #e8d48a; }
.health-banner-warn span { color: #cbbd85; }

  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e0e0e0;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .advisor-panel {
    position: fixed;
    z-index: 999999;
    width: 300px;
    background: rgba(20, 20, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(10px);
    overflow: hidden;
    transition: height 0.2s ease;
    /* The body has to be the part that scrolls when the panel is given a
       fixed height, otherwise resizing shorter just clips the advice */
    display: flex;
    flex-direction: column;
  }

  /* Dragging a corner must track the cursor exactly — the height animation
     leaves the box a frame behind and feels broken */
  .advisor-panel.resizing {
    transition: none;
    user-select: none;
  }

  .resize-handle {
    position: absolute;
    z-index: 2;
  }
  /* Handles sit fully INSIDE the panel. The panel needs overflow:hidden
     for its rounded corners, which clips anything hanging outside and makes
     it unhittable too — an outset handle left only a 3px grab target. */
  .resize-n, .resize-s { left: 14px; right: 14px; height: 7px; }
  .resize-e, .resize-w { top: 14px; bottom: 14px; width: 7px; }
  .resize-n { top: 0; }
  .resize-s { bottom: 0; }
  .resize-w { left: 0; }
  .resize-e { right: 0; }
  /* Corners sit above the edges so the diagonal wins in the overlap */
  .resize-ne, .resize-nw, .resize-se, .resize-sw {
    width: 16px; height: 16px; z-index: 3;
  }
  .resize-nw { top: 0; left: 0; }
  .resize-ne { top: 0; right: 0; }
  .resize-sw { bottom: 0; left: 0; }
  .resize-se { bottom: 0; right: 0; }

  /* A visible grip on the corner you are most likely to reach for */
  .resize-se::after {
    content: '';
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 7px;
    height: 7px;
    border-right: 2px solid rgba(255, 255, 255, 0.28);
    border-bottom: 2px solid rgba(255, 255, 255, 0.28);
    border-bottom-right-radius: 3px;
  }

  /* Nothing to grab when the panel is just a title bar */
  .advisor-panel.collapsed .resize-handle {
    display: none;
  }

  .advisor-panel.collapsed {
    height: auto !important;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    cursor: move;
    user-select: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header-title {
    font-size: 12px;
    font-weight: 600;
    color: #a0a0b0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .header-controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .header-btn {
    background: none;
    border: none;
    color: #808090;
    cursor: pointer;
    padding: 2px;
    font-size: 14px;
    line-height: 1;
    border-radius: 3px;
  }

  .header-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    /* Grow into whatever height the panel was resized to, and scroll the
       overflow rather than pushing past the bottom edge. min-height:0 is
       what actually lets a flex child shrink below its content. */
    flex: 1 1 auto;
    min-height: 0;
    max-height: var(--body-max-height, 500px);
    overflow-y: auto;
  }

  .body::-webkit-scrollbar {
    width: 4px;
  }

  .body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
  }

  /* Action recommendation */
  .action-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
  }

  .action-label {
    font-size: 20px;
    font-weight: 700;
    text-transform: uppercase;
    flex: 1;
  }

  .action-amount {
    font-size: 14px;
    font-weight: 400;
    opacity: 0.7;
    margin-left: 4px;
  }

  .action-fold { color: #ef4444; }
  .action-check { color: #3b82f6; }
  .action-call { color: #f59e0b; }
  .action-raise, .action-bet { color: #22c55e; }

  .confidence-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 12px;
    white-space: nowrap;
  }

  .confidence-high { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
  .confidence-med { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
  .confidence-low { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

  /* Stats row */
  .stats-row {
    display: flex;
    gap: 6px;
  }

  .stat-box {
    flex: 1;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    text-align: center;
  }

  .stat-value {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }

  .stat-label {
    font-size: 10px;
    color: #707080;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }

  /* Equity bar */
  .equity-bar-container {
    height: 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    overflow: hidden;
  }

  .equity-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .equity-good { background: linear-gradient(90deg, #22c55e, #4ade80); }
  .equity-ok { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
  .equity-bad { background: linear-gradient(90deg, #ef4444, #f87171); }

  /* Hand info */
  .hand-info {
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    font-size: 12px;
  }

  .hand-category {
    font-weight: 600;
    color: #fff;
    margin-bottom: 2px;
  }

  .board-texture {
    color: #808090;
    font-size: 11px;
  }

  /* Reasoning */
  .reasoning {
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
  }

  .reasoning-item {
    font-size: 11px;
    color: #a0a0b0;
    padding: 2px 0;
    padding-left: 10px;
    position: relative;
  }

  .reasoning-item::before {
    content: "\\2022";
    position: absolute;
    left: 0;
    color: #505060;
  }

  /* Alternatives */
  .alternatives {
    font-size: 11px;
    color: #606070;
    padding: 4px 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    padding-top: 8px;
  }

  .alt-item {
    margin-bottom: 2px;
  }

  .alt-action {
    color: #808090;
    font-weight: 600;
  }

  /* Waiting state */
  .waiting {
    text-align: center;
    padding: 20px 12px;
    color: #505060;
    font-size: 12px;
  }

  .waiting-dots::after {
    content: '';
    animation: dots 1.5s steps(3, end) infinite;
  }

  @keyframes dots {
    0% { content: ''; }
    33% { content: '.'; }
    66% { content: '..'; }
    100% { content: '...'; }
  }

  /* Opponent tracking badge */
  .track-toggle {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: none;
    color: #707080;
    cursor: pointer;
    margin-left: 4px;
  }

  .track-toggle.active {
    border-color: #22c55e;
    color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }

  .track-toggle:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  /* Player stats in overlay */
  .opponent-stats {
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 2px solid #3b82f6;
  }

  .opponent-stats-header {
    font-size: 11px;
    font-weight: 600;
    color: #3b82f6;
    margin-bottom: 4px;
  }

  .opponent-stat-line {
    font-size: 11px;
    color: #a0a0b0;
    margin-bottom: 1px;
  }
`;
