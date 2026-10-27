/**
 * A silent fallback needs a visible signal.
 *
 * The dealer button now reports -1 until it is actually located, and every
 * position falls back to the conservative default — first to act multiway,
 * out of position heads-up. That is the right answer for a misread, and it is
 * completely invisible: the advice simply gets tighter and nothing says why.
 *
 * If the button selector ever breaks, this warning is the only thing that
 * would tell you. Health checks exist precisely because every serious bug in
 * this project has been silent.
 */
import { checkHealth, healthLevel, HealthInput } from '../src/content/health';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    players: [
      { name: 'You', stack: 5000, isYou: true, isActive: true },
      { name: 'noob', stack: 5000, isYou: false, isActive: true },
    ],
    pot: 300, bigBlind: 100, communityCardCount: 3,
    haveHoleCards: true, yourTurn: true, availableActions: ['fold', 'call', 'raise'],
    mappings: {}, logAvailable: true,
    learningEnabled: true, learningLoaded: true,
    dealerSeatKnown: true,
    ...over,
  };
}

const codes = (i: HealthInput) => checkHealth(i).map(x => x.code);

console.log('\nan unlocated button is reported');
{
  const issues = checkHealth(input({ dealerSeatKnown: false }));
  const dealer = issues.find(i => i.code === 'dealer-unknown');
  expect('the issue is raised', dealer !== undefined, true);
  expect('as a warning, not an error', dealer?.severity, 'warning');
  expect('with something to do about it', typeof dealer?.fix, 'string');
  expect('and it degrades rather than breaks', healthLevel(issues), 'degraded');
}

console.log('\na located button says nothing');
{
  expect('no issue when known', codes(input({ dealerSeatKnown: true })).includes('dealer-unknown'), false);
  // Absent means "not reported", which must not fire the warning either
  expect('nor when the field is absent',
    codes(input({ dealerSeatKnown: undefined })).includes('dealer-unknown'), false);
}

console.log('\nit only matters while we are in a hand');
{
  expect('no cards, no warning',
    codes(input({ dealerSeatKnown: false, haveHoleCards: false })).includes('dealer-unknown'),
    false);
}

console.log('\nit does not disturb the other checks');
{
  const clean = checkHealth(input());
  expect('a healthy table stays healthy', healthLevel(clean), 'ok');
  const broken = checkHealth(input({ bigBlind: 0, dealerSeatKnown: false }));
  expect('a real error still outranks it', healthLevel(broken), 'broken');
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall dealer health signal tests passed');
