/**
 * The one place this extension puts chips in gets its own lock.
 *
 * `completeRaise` is asynchronous: it clicks RAISE, waits up to 600ms for the
 * amount box to appear, types the size, then submits the form. The keypress
 * cooldown is 700ms and starts at the press — so a second press could arrive
 * while the first sequence was still mid-flight, and the two would race over
 * the same input, one typing while the other submitted.
 *
 * A wrong number in that box is a real-money mistake, so the raise now holds
 * a flag of its own rather than trusting two timings not to overlap.
 *
 * Only the pure rules are exercised here; `installHotkey` binds to `window`
 * and belongs to the browser.
 */
import { HOTKEY, COOLDOWN_MS, refuseReason, isTypingTarget, buttonSelectorFor } from '../src/content/hotkey';
import { ActionType } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\nevery refusal is a way of acting on something stale or unasked-for');
{
  const base = {
    getAdvice: () => ({ action: 'call' as ActionType, street: 'flop' }),
    getStreet: () => 'flop',
    isYourTurn: () => true,
    onResult: () => {},
  };
  expect('a live spot is allowed', refuseReason(base), null);
  expect('not our turn', refuseReason({ ...base, isYourTurn: () => false }), "It's not your turn");
  expect('no advice yet', refuseReason({ ...base, getAdvice: () => null }), 'No advice yet');
  expect('advice from an earlier street',
    refuseReason({ ...base, getStreet: () => 'turn' }), 'Advice is from a previous street');
  expect('an action with no button',
    refuseReason({ ...base, getAdvice: () => ({ action: 'nonsense' as ActionType, street: 'flop' }) }),
    'Cannot click "nonsense"');
}

console.log('\ntyping is never an action');
{
  expect('an input', isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  expect('a textarea', isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  expect('a select', isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget), true);
  expect('a contenteditable',
    isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  expect('an ordinary div',
    isTypingTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget), false);
  expect('nothing at all', isTypingTarget(null), false);
}

console.log('\nthe cooldown outlasts the raise sequence it protects');
{
  /**
   * `waitFor` gives the amount box 600ms. If the cooldown were shorter, the
   * key would reopen for a second press while the first sequence was still
   * waiting for that box — which is the exact overlap the in-flight flag now
   * closes. Keeping the cooldown above the wait means the flag is a second
   * line of defence rather than the only one.
   */
  expect('cooldown exceeds the amount-box wait', COOLDOWN_MS > 600, true);
  expect('the key is the space bar', HOTKEY, ' ');
}

console.log('\nevery action maps to a real button, and nothing else does');
{
  for (const a of ['fold', 'check', 'call', 'bet', 'raise'] as ActionType[]) {
    expect(`${a} has a button`, typeof buttonSelectorFor(a), 'string');
  }
  expect('an unknown action has none',
    buttonSelectorFor('sit-out' as ActionType), null);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall hotkey guard tests passed');
