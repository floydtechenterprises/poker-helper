/**
 * Three observers share one debounce timer, so several events can land in a
 * single window. The type delivered used to be whichever fired LAST — and the
 * table observer fires 'state-change' on every mutation, including the
 * animations that accompany action buttons appearing.
 *
 * So a 'turn' was routinely overwritten by a 'state-change' arriving a few
 * milliseconds later. That is not cosmetic: the controller skips analysis
 * entirely for 'state-change' when it does not currently read as our turn, so
 * the one event meaning "you have to act" could be replaced by the one event
 * allowed to do nothing.
 */
import { GameObserver, GameEvent } from '../src/content/scraper/observers';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

/** Reach the private debounce directly — no DOM needed to test the policy. */
function deliver(sequence: GameEvent[]): Promise<GameEvent | null> {
  const obs = new GameObserver();
  let delivered: GameEvent | null = null;
  (obs as unknown as { callback: (e: GameEvent) => void }).callback = (e) => { delivered = e; };
  const fire = (obs as unknown as { fire(e: GameEvent): void }).fire.bind(obs);
  for (const e of sequence) fire(e);
  return new Promise(resolve => setTimeout(() => resolve(delivered), 250));
}

async function main(): Promise<void> {
  console.log('\nthe most significant event in a window wins');
  {
    expect('turn survives a later state-change',
      await deliver(['turn', 'state-change']), 'turn');
    expect('turn survives several',
      await deliver(['turn', 'state-change', 'state-change', 'cards']), 'turn');
    expect('cards beat state-change',
      await deliver(['state-change', 'cards']), 'cards');
    expect('turn beats cards',
      await deliver(['cards', 'turn']), 'turn');
  }

  console.log('\na single event is delivered unchanged');
  {
    expect('state-change alone', await deliver(['state-change']), 'state-change');
    expect('cards alone', await deliver(['cards']), 'cards');
    expect('turn alone', await deliver(['turn']), 'turn');
  }

  console.log('\nthe window resets between deliveries');
  {
    const obs = new GameObserver();
    const seen: GameEvent[] = [];
    (obs as unknown as { callback: (e: GameEvent) => void }).callback = (e) => { seen.push(e); };
    const fire = (obs as unknown as { fire(e: GameEvent): void }).fire.bind(obs);

    fire('turn');
    await new Promise(r => setTimeout(r, 250));
    fire('state-change');
    await new Promise(r => setTimeout(r, 250));

    expect('two separate deliveries', seen.length, 2);
    expect('the first is the turn', seen[0], 'turn');
    // A stale 'turn' must not leak into the next window
    expect('the second is not a leftover turn', seen[1], 'state-change');
  }
}

main().then(() => {
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall observer priority tests passed');
});
