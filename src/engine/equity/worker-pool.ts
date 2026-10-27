import { Card } from '../types';
import { equityWorkerCount } from '../../shared/constants';
import { RangeSpec } from './range-spec';

interface WorkerResult {
  wins: number;
  ties: number;
  losses: number;
  samples: number;
}

export class EquityWorkerPool {
  private workers: Worker[] = [];
  private ready = false;
  /** Monotonic id so a late reply can be told from a current one. */
  private nextRequestId = 0;
  /** Kept so the blob can be released when the pool is torn down. */
  private blobUrl: string | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    try {
      // Content scripts can't spawn a Worker from a chrome-extension:// URL
      // directly (cross-origin) — fetch the script and boot it from a blob
      const workerUrl = chrome.runtime.getURL('equity-worker.js');
      const source = await (await fetch(workerUrl)).text();
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      this.blobUrl = blobUrl;
      const count = equityWorkerCount();
      for (let i = 0; i < count; i++) {
        this.workers.push(new Worker(blobUrl));
      }
      this.ready = true;
    } catch (err) {
      console.warn('[Poker Advisor] Equity workers unavailable, using main thread', err);
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready && this.workers.length > 0;
  }

  async calculate(
    holeCards: [Card, Card],
    communityCards: Card[],
    numOpponents: number,
    totalIterations: number,
    opponentRange: number | RangeSpec = 1,
  ): Promise<{ equity: number; wins: number; ties: number; losses: number; samples: number }> {
    if (!this.ready || this.workers.length === 0) {
      throw new Error('Worker pool not initialized');
    }

    const iterPerWorker = Math.ceil(totalIterations / this.workers.length);

    /**
     * Every request carries an id, and replies that do not match are ignored.
     *
     * Without it, a timed-out request left its `message` listener attached
     * forever — the handler only removed itself on success. The next reply
     * from that worker then fired BOTH the stale handler and the new one, so
     * a fresh request could be resolved with the PREVIOUS hand's equity.
     * Nothing would look wrong: a plausible number, attributed to the wrong
     * cards, overriding the main thread's own calculation.
     */
    const requestId = ++this.nextRequestId;
    const cleanups: (() => void)[] = [];

    const promises = this.workers.map((worker) =>
      new Promise<WorkerResult>((resolve, reject) => {
        const onMessage = (e: MessageEvent<WorkerResult & { id?: number; error?: string }>) => {
          // A reply for an abandoned request is not an answer to this one
          if (e.data?.id !== requestId) return;
          cleanup();
          if (e.data.error) reject(new Error(`equity worker: ${e.data.error}`));
          else resolve(e.data);
        };
        // A worker that throws posts nothing at all, so without this the
        // promise simply never settles and every analysis pays the full
        // timeout — seconds of stale advice for what is an instant failure.
        const onError = (err: ErrorEvent) => {
          cleanup();
          reject(new Error(`equity worker crashed: ${err.message}`));
        };
        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        };
        cleanups.push(cleanup);

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({
          id: requestId,
          holeCards,
          communityCards,
          numOpponents,
          iterations: iterPerWorker,
          opponentRange,
        });
      })
    );

    // Guard: a dead worker must not hang the whole evaluation
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('equity worker timeout')), 4000);
    });

    let results: WorkerResult[];
    try {
      results = await Promise.race([Promise.all(promises), timeout]);
    } finally {
      // Detach on EVERY exit path, including the timeout. Leaving listeners
      // behind is what allowed one hand's result to answer another's.
      clearTimeout(timer);
      for (const c of cleanups) c();
    }

    let totalWins = 0, totalTies = 0, totalLosses = 0, totalSamples = 0;
    for (const r of results) {
      totalWins += r.wins;
      totalTies += r.ties;
      totalLosses += r.losses;
      totalSamples += r.samples;
    }

    // Zero samples means every worker refused the input (a malformed board,
    // say). Dividing here would hand back NaN as an equity, and
    // `precomputedEquity` overrides the advisor's own calculation — so a
    // NaN would propagate into the decision instead of being noticed.
    // Throwing routes it to the caller's main-thread fallback.
    if (totalSamples === 0) {
      throw new Error('equity workers returned no samples');
    }

    return {
      equity: (totalWins + totalTies * 0.5) / totalSamples,
      wins: totalWins,
      ties: totalTies,
      losses: totalLosses,
      samples: totalSamples,
    };
  }

  destroy(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    // The blob keeps the worker source alive in memory until it is revoked
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
    this.ready = false;
  }
}
