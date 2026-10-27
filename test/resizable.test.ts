/**
 * Window-style resizing is mostly a geometry problem, and the geometry is
 * where it goes wrong: dragging a left or top edge has to move the panel as
 * well as resize it, or the opposite edge walks across the screen. Every
 * awkward case is a question about resolveResize, so it is tested directly
 * rather than through the DOM.
 */
import { resolveResize, MIN_WIDTH, MIN_HEIGHT } from '../src/content/ui/resizable';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const VIEW = { width: 1920, height: 1080 };
const START = { left: 500, top: 300, width: 300, height: 400 };

console.log('dragging the bottom-right corner');
{
  const r = resolveResize('se', START, 120, 80, VIEW);
  expect('grows the width', r.width, 420);
  expect('grows the height', r.height, 480);
  expect('leaves the left edge alone', r.left, 500);
  expect('leaves the top edge alone', r.top, 300);
}

console.log('dragging the left edge keeps the right edge still');
{
  const r = resolveResize('w', START, -100, 0, VIEW);
  expect('moves the panel left', r.left, 400);
  expect('and widens by the same amount', r.width, 400);
  expect('so the right edge has not moved', r.left + r.width, START.left + START.width);
}

console.log('dragging the top edge keeps the bottom edge still');
{
  const r = resolveResize('n', START, 0, 60, VIEW);
  expect('moves the panel down', r.top, 360);
  expect('and shortens it', r.height, 340);
  expect('so the bottom edge has not moved', r.top + r.height, START.top + START.height);
}

console.log('a single edge never changes the other axis');
{
  const e = resolveResize('e', START, 50, 999, VIEW);
  expect('east drag leaves the height alone', e.height, START.height);
  const s = resolveResize('s', START, 999, 50, VIEW);
  expect('south drag leaves the width alone', s.width, START.width);
}

console.log('the minimum size holds, and holds in the right direction');
{
  // Yanking the right edge far past the left one
  const se = resolveResize('se', START, -5000, -5000, VIEW);
  expect('never narrower than the minimum', se.width, MIN_WIDTH);
  expect('never shorter than the minimum', se.height, MIN_HEIGHT);
  expect('anchored edge stays put', se.left, START.left);

  // Same, but anchored to the opposite side: the panel must stop rather
  // than continue sliding right once it hits the minimum width
  const nw = resolveResize('nw', START, 5000, 5000, VIEW);
  expect('minimum width from the west', nw.width, MIN_WIDTH);
  expect('and the right edge still has not moved',
    nw.left + nw.width, START.left + START.width);
  expect('minimum height from the north', nw.height, MIN_HEIGHT);
  expect('and the bottom edge still has not moved',
    nw.top + nw.height, START.top + START.height);
}

console.log('it cannot be dragged off screen');
{
  const nw = resolveResize('nw', { left: 40, top: 30, width: 300, height: 400 },
    -500, -500, VIEW);
  expect('left edge stops at zero', nw.left, 0);
  expect('top edge stops at zero', nw.top, 0);

  const se = resolveResize('se', { left: 1800, top: 1000, width: 300, height: 400 },
    5000, 5000, VIEW);
  expect('right edge stops at the viewport', se.left + se.width <= VIEW.width, true);
  expect('bottom edge stops at the viewport', se.top + se.height <= VIEW.height, true);
}

console.log('a viewport smaller than the minimum still yields a usable box');
{
  // Phone-sized window: the minimum wins over the viewport, since a
  // zero-width panel is worse than one that overhangs slightly
  const r = resolveResize('se', { left: 0, top: 0, width: 300, height: 400 },
    5000, 5000, { width: 150, height: 100 });
  expect('width never collapses below the minimum', r.width, MIN_WIDTH);
  expect('height never collapses below the minimum', r.height, MIN_HEIGHT);
}

console.log('no drag produces nonsense');
{
  let bad = 0;
  const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
  for (const dir of dirs) {
    for (const dx of [-9999, -300, -1, 0, 1, 300, 9999]) {
      for (const dy of [-9999, -300, -1, 0, 1, 300, 9999]) {
        const r = resolveResize(dir, START, dx, dy, VIEW);
        const vals = [r.left, r.top, r.width, r.height];
        if (vals.some(v => !Number.isFinite(v))) bad++;
        if (r.width < MIN_WIDTH || r.height < MIN_HEIGHT) bad++;
        if (r.left < 0 || r.top < 0) bad++;
      }
    }
  }
  expect('392 drags all produce a legal, on-screen box', bad, 0);
}

process.exit(failures > 0 ? 1 : 0);
