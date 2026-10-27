/**
 * Bug 12: saveSessionSummary does a read-modify-write on chrome.storage.
 * Without serialization, two writes landing close together both read the
 * old array and one update is lost. This reproduces the failure with a
 * fake async store, then proves the promise-chain fix prevents it.
 */
let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

/** Async key-value store with realistic (non-instant) reads and writes. */
function makeStore() {
  let data: Record<string, any> = {};
  return {
    get(key: string, cb: (v: any) => void) {
      setTimeout(() => cb({ [key]: data[key] }), 5);
    },
    set(obj: Record<string, any>, cb?: () => void) {
      setTimeout(() => { data = { ...data, ...obj }; cb?.(); }, 5);
    },
    read: () => data,
  };
}

/** The buggy version: fire-and-forget read-modify-write. */
function unserializedWrite(store: ReturnType<typeof makeStore>, item: any): void {
  store.get('history', (result) => {
    const history: any[] = Array.isArray(result.history) ? result.history : [];
    const idx = history.findIndex(h => h.id === item.id);
    if (idx >= 0) history[idx] = item;
    else history.push(item);
    store.set({ history });
  });
}

/** The fixed version: each write waits for the previous one. */
function makeSerializedWriter(store: ReturnType<typeof makeStore>) {
  let chain: Promise<void> = Promise.resolve();
  return (item: any) => {
    chain = chain.then(() => new Promise<void>((resolve) => {
      store.get('history', (result) => {
        const history: any[] = Array.isArray(result.history) ? result.history : [];
        const idx = history.findIndex(h => h.id === item.id);
        if (idx >= 0) history[idx] = item;
        else history.push(item);
        store.set({ history }, () => resolve());
      });
    })).catch(() => {});
    return chain;
  };
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('serialized storage writes');

  // Demonstrate the bug is real with this harness
  {
    const store = makeStore();
    unserializedWrite(store, { id: 'a', v: 1 });
    unserializedWrite(store, { id: 'b', v: 2 });
    await wait(60);
    const lost = (store.read().history || []).length < 2;
    expect('unserialized writes DO lose an update (bug reproduced)', lost, true);
  }

  // The fix keeps both
  {
    const store = makeStore();
    const write = makeSerializedWriter(store);
    write({ id: 'a', v: 1 });
    const last = write({ id: 'b', v: 2 });
    await last;
    await wait(20);
    const history = store.read().history || [];
    expect('serialized writes keep both entries', history.length, 2);
    expect('first entry survived', history.some((h: any) => h.id === 'a'), true);
    expect('second entry survived', history.some((h: any) => h.id === 'b'), true);
  }

  // Updating the same id replaces rather than duplicating
  {
    const store = makeStore();
    const write = makeSerializedWriter(store);
    write({ id: 'a', v: 1 });
    write({ id: 'a', v: 2 });
    await write({ id: 'a', v: 3 });
    await wait(20);
    const history = store.read().history || [];
    expect('same id stays a single entry', history.length, 1);
    expect('latest value wins', history[0].v, 3);
  }

  process.exit(failures > 0 ? 1 : 0);
}

main();
