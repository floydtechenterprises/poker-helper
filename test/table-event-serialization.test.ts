/**
 * Table events must be handled one at a time, in order.
 *
 * `onTableChange` is fire-and-forget from the observer and awaits real work
 * inside — settling a hand writes to IndexedDB and saves every tracked
 * profile. The observer fires again 150ms later, so a second call could enter
 * while the first was suspended on a write.
 *
 * The worst ordering is concrete: the second call's `actions.update()`
 * landing before the first call's `actions.reset()`, which folds one hand's
 * actions into the next hand's statistics — a corruption that is invisible
 * because both numbers stay plausible.
 *
 * `onGameStateChange` guards itself by SKIPPING overlapping calls, which is
 * right when the work is recomputing advice. Skipping here could drop a hand
 * boundary, so these are queued instead.
 */

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

/**
 * The queueing policy, isolated from the controller's DOM dependencies.
 * Mirrors the implementation exactly: chain, cap the depth, never let one
 * rejection stall the chain.
 */
class Queue {
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;
  readonly log: string[] = [];

  push(id: string, work: () => Promise<void>): Promise<void> {
    if (this.depth > 2) { this.log.push(`${id}:dropped`); return this.chain; }
    this.depth++;
    this.chain = this.chain
      .then(() => work())
      .catch(() => { this.log.push(`${id}:threw`); })
      .finally(() => { this.depth--; });
    return this.chain;
  }

  get pending(): number { return this.depth; }
  idle(): Promise<void> { return this.chain; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('\nhandlers never overlap');
  {
    const q = new Queue();
    let inFlight = 0;
    let maxInFlight = 0;
    const work = (id: string) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(20);
      q.log.push(id);
      inFlight--;
    };
    q.push('a', work('a'));
    q.push('b', work('b'));
    q.push('c', work('c'));
    await q.idle();

    expect('only one handler runs at a time', maxInFlight, 1);
    expect('and they run in order', q.log.join(','), 'a,b,c');
  }

  console.log('\na thrown handler does not stall the queue');
  {
    const q = new Queue();
    q.push('bad', async () => { throw new Error('write failed'); });
    q.push('good', async () => { q.log.push('good'); });
    await q.idle();
    expect('the next event still runs', q.log.includes('good'), true);
  }

  console.log('\nthe queue is depth-capped rather than unbounded');
  {
    const q = new Queue();
    const slow = () => sleep(40);
    for (let i = 0; i < 10; i++) q.push(`e${i}`, slow);
    const dropped = q.log.filter(l => l.endsWith(':dropped')).length;
    expect('excess events are dropped, not stacked', dropped > 0, true);
    await q.idle();
    expect('and the queue drains', q.pending, 0);
  }

  console.log('\nan idle queue accepts work immediately');
  {
    const q = new Queue();
    await q.idle();
    let ran = false;
    q.push('x', async () => { ran = true; });
    await q.idle();
    expect('work runs after draining', ran, true);
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall table event serialization tests passed');
}

main();
