export const DB_NAME = 'poker-advisor';
export const DB_VERSION = 2;
export const STORE_HANDS = 'hand-history';
export const STORE_DECISIONS = 'decision-log';

export const DEFAULT_MC_ITERATIONS = 5000;
export const PREFLOP_MC_ITERATIONS = 3000;
/** The floor, for a machine that will not say how many cores it has. */
export const WORKER_COUNT = 2;
/** Never take the whole machine: the page, the browser and the game need cores too. */
export const MAX_WORKERS = 8;

/**
 * How many equity workers to run.
 *
 * This was a flat 2 on every machine. Equity is the slow part of a decision —
 * a Monte Carlo over thousands of runouts — and it is split across the pool,
 * so on a 24-core desktop two workers left the answer several times slower
 * than the machine could give it, while a laptop ran the same two.
 *
 * Cores minus two, so the page's own thread and the browser keep one each,
 * bounded at MAX_WORKERS: past that the split costs more in messaging than
 * the extra parallelism returns, and a poker decision is one short burst.
 */
export function equityWorkerCount(
  cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
): number {
  if (!cores || !Number.isFinite(cores)) return WORKER_COUNT;
  return Math.max(WORKER_COUNT, Math.min(MAX_WORKERS, Math.floor(cores) - 2));
}

export const DEBOUNCE_MS = 150;
export const BADGE_REFRESH_MS = 2000;

export const OVERLAY_DEFAULT_X = 20;
export const OVERLAY_DEFAULT_Y = 20;
// OVERLAY_WIDTH removed: the panel sizes itself to its content and stores a
// user-chosen width, so a fixed default was never read by anything.
