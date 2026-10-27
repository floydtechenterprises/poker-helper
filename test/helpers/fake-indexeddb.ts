/**
 * Just enough IndexedDB to run `src/data/db.ts` under Node.
 *
 * Several defects live inside `GameController` methods whose only data
 * source is the page's IndexedDB. Testing them needs the controller driven
 * for real, and jsdom supplies no `indexedDB`, so there was no way to reach
 * that code from a test at all — which is a fair part of why those fixes
 * ended up with tests aimed at their new helper functions instead of at the
 * behaviour that was wrong.
 *
 * This is a fake, not an implementation: synchronous maps behind the
 * callback shapes `db.ts` actually uses (open/upgrade, transaction,
 * objectStore, get/getAll/put/add/delete/clear, autoIncrement keys, and
 * `createIndex` accepted and ignored). Success callbacks fire on a
 * microtask, as the real thing does, so code that assigns `onsuccess`
 * after making the request still sees it.
 *
 * It deliberately does NOT implement indexes, cursors, key ranges or
 * versioning beyond the upgrade hook. Anything needing those should get a
 * real fake library rather than quietly growing this one.
 */

type Store = {
  keyPath: string;
  autoIncrement: boolean;
  rows: Map<any, any>;
  nextKey: number;
};

const soon = (fn: () => void) => queueMicrotask(fn);

class FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(private store: Store, private tx: FakeTransaction) {}

  private key(value: any, explicit?: any): any {
    if (explicit !== undefined) return explicit;
    const fromPath = value?.[this.store.keyPath];
    if (fromPath !== undefined) return fromPath;
    if (this.store.autoIncrement) return this.store.nextKey++;
    throw new Error(`no key for ${this.store.keyPath}`);
  }

  get(key: any): FakeRequest<any> {
    const req = new FakeRequest<any>();
    soon(() => { req.result = this.store.rows.get(key); req.onsuccess?.(); });
    return req;
  }

  getAll(): FakeRequest<any[]> {
    const req = new FakeRequest<any[]>();
    soon(() => { req.result = [...this.store.rows.values()]; req.onsuccess?.(); });
    return req;
  }

  put(value: any, key?: any): FakeRequest<any> {
    const req = new FakeRequest<any>();
    const k = this.key(value, key);
    this.store.rows.set(k, value);
    this.tx.touched();
    soon(() => { req.result = k; req.onsuccess?.(); });
    return req;
  }

  add(value: any, key?: any): FakeRequest<any> {
    const k = this.key(value, key);
    // Mirror the real store: autoIncrement keys are written back onto the
    // record, which is how callers learn the id they were given.
    if (this.store.autoIncrement && value && typeof value === 'object'
      && value[this.store.keyPath] === undefined) {
      value[this.store.keyPath] = k;
    }
    return this.put(value, k);
  }

  delete(key: any): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.store.rows.delete(key);
    this.tx.touched();
    soon(() => req.onsuccess?.());
    return req;
  }

  clear(): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.store.rows.clear();
    this.tx.touched();
    soon(() => req.onsuccess?.());
    return req;
  }

  /** Accepted and ignored: nothing under test reads through an index. */
  createIndex(): { name: string } { return { name: 'ignored' }; }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;
  private done = false;

  constructor(private db: FakeDB) {
    // Complete once the caller has finished issuing requests.
    soon(() => soon(() => this.finish()));
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`no object store "${name}"`);
    return new FakeObjectStore(store, this);
  }

  /** A write happened; nothing to do beyond keeping the shape honest. */
  touched(): void {}

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.oncomplete?.();
  }
}

class FakeDB {
  stores = new Map<string, Store>();
  onclose: (() => void) | null = null;
  onversionchange: (() => void) | null = null;

  get objectStoreNames() {
    const names = [...this.stores.keys()];
    return { contains: (n: string) => names.includes(n), length: names.length };
  }

  createObjectStore(
    name: string, opts?: { keyPath?: string; autoIncrement?: boolean },
  ): FakeObjectStore {
    const store: Store = {
      keyPath: opts?.keyPath ?? 'id',
      autoIncrement: opts?.autoIncrement ?? false,
      rows: new Map(),
      nextKey: 1,
    };
    this.stores.set(name, store);
    return new FakeObjectStore(store, new FakeTransaction(this));
  }

  transaction(_names: string | string[], _mode?: string): FakeTransaction {
    return new FakeTransaction(this);
  }

  close(): void { this.onclose?.(); }
}

/**
 * Install a fresh, empty database as `globalThis.indexedDB`.
 *
 * Returns the database so a test can seed a store directly, which is far
 * less ceremony than driving `db.ts` just to put a row in place.
 */
export function installFakeIndexedDB(): FakeDB {
  const db = new FakeDB();
  (globalThis as any).indexedDB = {
    open(_name: string, _version?: number) {
      const req = new FakeRequest<FakeDB>();
      req.result = db;
      soon(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase() {
      const req = new FakeRequest<undefined>();
      soon(() => req.onsuccess?.());
      return req;
    },
  };
  return db;
}

/** Put rows straight into a store, bypassing `db.ts`. */
export function seed(db: FakeDB, storeName: string, rows: any[], keyPath = 'name'): void {
  let store = db.stores.get(storeName);
  if (!store) {
    store = { keyPath, autoIncrement: false, rows: new Map(), nextKey: 1 };
    db.stores.set(storeName, store);
  }
  for (const r of rows) store.rows.set(r[store.keyPath], r);
}
