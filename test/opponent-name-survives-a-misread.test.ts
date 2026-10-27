/**
 * L16: a momentary misread does not drop us back to pooled learning.
 *
 * currentOpponentName returned null whenever the tracked player read as
 * inactive, or the table could not be read for a tick. The decision was then
 * filed under nobody — and at load time a null collapses the whole
 * per-opponent layer to the pooled history, silently.
 */
import { opponentFor } from '../src/content/controller';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
const maps = { brant: 'brant', noob: 'noob' };
const you = { name: 'me', isYou: true, isActive: true };

console.log('\nheads-up');
expect('an active tracked opponent', opponentFor([you, { name: 'brant', isYou: false, isActive: true }], maps, null), 'brant');
expect('still him when read inactive for a tick',
  opponentFor([you, { name: 'brant', isYou: false, isActive: false }], maps, null), 'brant');
expect('the last known opponent when the table cannot be read', opponentFor([], maps, 'brant'), 'brant');
expect('nobody when he is not tracked', opponentFor([you, { name: 'stranger', isYou: false, isActive: true }], maps, 'brant'), null);

console.log('\nmultiway');
expect('a folded tracked player is not the opponent',
  opponentFor([you, { name: 'noob', isYou: false, isActive: false }, { name: 'stranger', isYou: false, isActive: true }], maps, null),
  null);
expect('an active one is',
  opponentFor([you, { name: 'noob', isYou: false, isActive: true }, { name: 'stranger', isYou: false, isActive: true }], maps, null),
  'noob');

console.log(failures > 0 ? `\n${failures} opponent-name test(s) failed` : '\nall opponent-name tests passed');
process.exit(failures > 0 ? 1 : 0);
