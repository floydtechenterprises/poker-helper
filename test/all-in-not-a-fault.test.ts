/**
 * Being all-in is not a broken read.
 *
 * The stack-zero warning fired whenever we held cards with nothing behind —
 * which is the definition of being all-in, and the most common way a
 * hyper-turbo hand ends. So the indicator went amber on ordinary hands, with
 * a message implying the table was being misread.
 *
 * That is the same mistake as the fold-detection warning that fired on every
 * fold: a warning which appears when nothing is wrong teaches you to ignore
 * the indicator, and the indicator is the one signal that catches the silent
 * bugs. It is worse than having no warning at all.
 *
 * The genuine contradiction is being ASKED TO ACT with no chips to act with.
 * An all-in player is never offered buttons.
 */
import { checkHealth, healthLevel } from '../src/content/health';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

function health(over: Partial<Parameters<typeof checkHealth>[0]>) {
  return checkHealth({
    players: [
      { name: 'flight', stack: 0, isYou: true, isActive: true },
      { name: 'noob', stack: 1760, isYou: false, isActive: true },
    ],
    pot: 18240, bigBlind: 640, communityCardCount: 5,
    haveHoleCards: true,
    yourTurn: false, availableActions: [],
    mappings: {}, logAvailable: true,
    learningEnabled: false, learningLoaded: false,
    dealerSeatKnown: true,
    ...over,
  });
}

const hasZero = (i: ReturnType<typeof checkHealth>) => i.some(x => x.code === 'stack-zero');

console.log('\nall-in with the hand playing out is not a fault');
{
  // Exactly the screenshot: shoved, no chips behind, board run out, no buttons
  const issues = health({});
  expect('no stack warning', hasZero(issues), false);
  expect('and the indicator stays clean', healthLevel(issues), 'ok');
}

console.log('\nno chips AND being asked to act is a genuine contradiction');
{
  const issues = health({ yourTurn: true, availableActions: ['fold', 'call'] });
  expect('the warning fires', hasZero(issues), true);
  expect('as a warning, not an error', healthLevel(issues), 'degraded');
}

console.log('\nhaving chips is never a stack warning');
{
  const issues = health({
    players: [
      { name: 'flight', stack: 5000, isYou: true, isActive: true },
      { name: 'noob', stack: 1760, isYou: false, isActive: true },
    ],
    yourTurn: true, availableActions: ['fold', 'call', 'raise'],
  });
  expect('a normal spot is clean', hasZero(issues), false);
}

console.log('\nnot holding cards is never a stack warning');
{
  // Sitting out or between hands — a zero stack says nothing
  const issues = health({ haveHoleCards: false, yourTurn: true, availableActions: ['fold'] });
  expect('no cards, no claim', hasZero(issues), false);
}

console.log('\nreal faults still surface');
{
  const issues = health({ bigBlind: 0 });
  expect('unreadable blinds are an error', healthLevel(issues), 'broken');
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall all-in health tests passed');

console.log('\na finished hand is not a broken read');
{
  /**
   * The pot is paid to the winner and resets to zero while the board stays on
   * screen through the showdown. "Board present, pot zero" is exactly what a
   * finished hand looks like, and this fired as an ERROR on every hand that
   * reached a flop.
   */
  const issues = health({
    pot: 0, communityCardCount: 5,
    yourTurn: false, availableActions: [],
  });
  expect('no pot warning between hands', issues.some(i => i.code === 'pot-zero'), false);
  expect('and the indicator stays clean', healthLevel(issues), 'ok');
}

console.log('\nan empty pot WHILE acting is still a real fault');
{
  const issues = health({
    pot: 0, communityCardCount: 3,
    players: [
      { name: 'flight', stack: 5000, isYou: true, isActive: true },
      { name: 'noob', stack: 1760, isYou: false, isActive: true },
    ],
    yourTurn: true, availableActions: ['check', 'bet'],
  });
  expect('the error fires', issues.some(i => i.code === 'pot-zero'), true);
  expect('as an error', healthLevel(issues), 'broken');
}

console.log('\nthe dealer warning is also only for live decisions');
{
  const between = health({ dealerSeatKnown: false, yourTurn: false, availableActions: [] });
  expect('quiet between hands', between.some(i => i.code === 'dealer-unknown'), false);

  const acting = health({
    dealerSeatKnown: false, yourTurn: true, availableActions: ['fold', 'call'],
    players: [
      { name: 'flight', stack: 5000, isYou: true, isActive: true },
      { name: 'noob', stack: 1760, isYou: false, isActive: true },
    ],
  });
  expect('reported while acting', acting.some(i => i.code === 'dealer-unknown'), true);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall health false-positive tests passed');
