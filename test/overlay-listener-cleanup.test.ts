/**
 * Destroying the overlay must remove what creating it added.
 *
 * `makeDraggable` and `makeResizable` attach their move and release handlers
 * to `document`, not to the panel — they have to, or a drag would stop the
 * moment the cursor left the box. So removing the host element does not
 * remove them.
 *
 * Every stop/start of a session builds a new overlay and added another pair,
 * each closing over a panel no longer in the document (so it can never be
 * collected) and each running on every mouse movement for the life of the
 * tab. Nothing visible goes wrong, because their drag flags are false. That
 * is precisely why it accumulated unnoticed.
 */
import { makeDraggable } from '../src/content/ui/draggable';
import { makeResizable } from '../src/content/ui/resizable';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

/** A document stub that simply counts what is attached to it. */
function fakeDocument() {
  const listeners = new Map<string, Set<unknown>>();
  return {
    listeners,
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    addEventListener(type: string, fn: unknown) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: unknown) {
      listeners.get(type)?.delete(fn);
    },
    createElement: () => fakePanel(),
  };
}

function fakePanel() {
  return {
    className: '', style: { cursor: '', setProperty: () => {} },
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    offsetLeft: 0, offsetTop: 0, offsetWidth: 300, offsetHeight: 200,
    addEventListener: () => {}, appendChild: () => {},
  } as unknown as HTMLElement;
}

console.log('\ndragging cleans up after itself');
{
  const doc = fakeDocument();
  (globalThis as { document?: unknown }).document = doc;
  const before = doc.count();
  const undo = makeDraggable(fakePanel(), fakePanel());
  expect('listeners were added', doc.count() > before, true);
  undo();
  expect('and all of them removed', doc.count(), before);
}

console.log('\nresizing cleans up after itself');
{
  const doc = fakeDocument();
  (globalThis as { document?: unknown }).document = doc;
  const before = doc.count();
  const undo = makeResizable(fakePanel());
  expect('listeners were added', doc.count() > before, true);
  undo();
  expect('and all of them removed', doc.count(), before);
}

console.log('\nrepeated create/destroy cycles do not accumulate');
{
  const doc = fakeDocument();
  (globalThis as { document?: unknown }).document = doc;
  for (let i = 0; i < 20; i++) {
    const a = makeDraggable(fakePanel(), fakePanel());
    const b = makeResizable(fakePanel());
    a(); b();
  }
  expect('nothing is left attached', doc.count(), 0);
}

console.log('\ncleanup is safe to call twice');
{
  const doc = fakeDocument();
  (globalThis as { document?: unknown }).document = doc;
  const undo = makeDraggable(fakePanel(), fakePanel());
  undo();
  undo();
  expect('still clean', doc.count(), 0);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall overlay cleanup tests passed');
