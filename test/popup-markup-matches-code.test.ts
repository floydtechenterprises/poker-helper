/**
 * Every element the popup reaches for must actually be in its markup.
 *
 * `$` is `document.getElementById(id)!` — a non-null assertion over
 * something that very much can be null. A lookup for an element that is not
 * there returns null, the next `.addEventListener` throws, and because all
 * of this runs inside one `init`, the throw takes the WHOLE popup with it.
 * Not one broken feature: no Start button, no settings, nothing.
 *
 * This is not hypothetical. Deleting the tracked-player and backup sections
 * from the markup left four lookups behind — `backup-btn`, `restore-btn`,
 * `pregame-mapping-list`, `pregame-status` — and every one of them would
 * have killed the popup on open, which is exactly the kind of silent,
 * total failure that is hardest to attribute to the change that caused it.
 *
 * The check is crude on purpose: a regex over both files, no DOM, no build
 * step. It only has to catch an id that exists in one file and not the
 * other, and it costs nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const root = process.cwd();
const ts = readFileSync(join(root, 'src/popup/popup.ts'), 'utf8');
const html = readFileSync(join(root, 'src/popup/popup.html'), 'utf8');

const lookedUp = [...new Set(
  [...ts.matchAll(/\$\('([a-zA-Z0-9_-]+)'\)/g)].map(m => m[1]),
)].sort();
const declared = new Set(
  [...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]),
);

console.log('every id the popup looks up exists in the markup');
{
  check('there are lookups to check at all', lookedUp.length > 5,
    `found ${lookedUp.length}`);

  const missing = lookedUp.filter(id => !declared.has(id));
  check('none of them is missing', missing.length === 0,
    `looked up but not in popup.html: ${missing.join(', ')}\n`
    + '       each of these throws in init and takes the whole popup down');
}

console.log('and the markup has no section the code never touches');
{
  /**
   * The other direction is a warning rather than a failure. A few ids are
   * only ever used as CSS hooks or by `setupToggle`, which takes them as
   * plain strings, so an unreferenced id is not automatically dead — but a
   * whole section nobody reads usually is.
   */
  const unused = [...declared].filter(id => !ts.includes(`'${id}'`)).sort();
  console.log(`  NOTE ${unused.length} id(s) in the markup are not named in popup.ts`
    + (unused.length ? `: ${unused.join(', ')}` : ''));
}

if (failures > 0) {
  console.error(`\n${failures} popup markup test(s) failed`);
  process.exit(1);
}
console.log('\nall popup markup tests passed');
