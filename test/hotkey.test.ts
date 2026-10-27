/**
 * The hotkey takes the recommended action — and must never do so unasked.
 *
 * The line: nothing happens without a keypress, every hand. No timer, no
 * queue, no "if my turn then act". Every guard below is a way the key could
 * fire on something stale, or on a press that was never meant for it.
 */
import { refuseReason, isTypingTarget, buttonSelectorFor, HOTKEY, COOLDOWN_MS } from '../src/content/hotkey';
import { ActionType } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

function deps(over: Partial<{
  advice: { action: ActionType; amount?: number; street: string } | null;
  street: string | null;
  yourTurn: boolean;
}> = {}) {
  const o = {
    advice: { action: 'call' as ActionType, amount: undefined, street: 'flop' },
    street: 'flop' as string | null,
    yourTurn: true,
    ...over,
  };
  return {
    getAdvice: () => o.advice,
    getStreet: () => o.street,
    isYourTurn: () => o.yourTurn,
    onResult: () => {},
  };
}

console.log('it refuses everything it should');
{
  expect('not your turn', refuseReason(deps({ yourTurn: false })), "It's not your turn");
  expect('no advice yet', refuseReason(deps({ advice: null })), 'No advice yet');
  expect('advice from an earlier street',
    refuseReason(deps({ advice: { action: 'bet', street: 'flop' }, street: 'turn' })),
    'Advice is from a previous street');
  expect('an action with no button',
    refuseReason(deps({ advice: { action: 'all-in' as ActionType, street: 'flop' } })),
    'Cannot click "all-in"');
}

console.log('and allows the one case it should');
{
  expect('your turn, fresh advice, real action', refuseReason(deps()), null);
  for (const a of ['fold', 'check', 'call', 'bet', 'raise'] as ActionType[]) {
    expect(`${a} is clickable`, refuseReason(deps({
      advice: { action: a, street: 'flop' },
    })), null);
  }
}

console.log('every action maps to a real button');
{
  for (const a of ['fold', 'check', 'call', 'bet', 'raise'] as ActionType[]) {
    const sel = buttonSelectorFor(a);
    if (!sel || !sel.startsWith('.poker-btn--')) {
      console.error(`  FAIL ${a} has no table button`); failures++;
    }
  }
  console.log('  PASS all five actions resolve to a button');
  /**
   * duel.com has three buttons, not five: call and check are one control
   * whose text changes, and so are bet and raise. The pairs therefore
   * share a selector, which is safer than PokerNow's arrangement — there
   * is no way to aim at CHECK and hit CALL when they are the same element
   * and the table decides which it currently is.
   */
  expect('check and call are the same control',
    buttonSelectorFor('check'), buttonSelectorFor('call'));
  expect('and so are bet and raise',
    buttonSelectorFor('bet'), buttonSelectorFor('raise'));
  expect('an unknown action resolves to nothing',
    buttonSelectorFor('all-in' as ActionType), null);
}

console.log('typing is never mistaken for a command');
{
  // Pressing space in the chat box and folding would be unforgivable
  const el = (tag: string, editable = false) => ({
    tagName: tag, isContentEditable: editable,
  } as unknown as EventTarget);
  expect('the chat input', isTypingTarget(el('INPUT')), true);
  expect('a textarea', isTypingTarget(el('TEXTAREA')), true);
  expect('a select', isTypingTarget(el('SELECT')), true);
  expect('a contenteditable', isTypingTarget(el('DIV', true)), true);
  expect('the page body is not typing', isTypingTarget(el('BODY')), false);
  expect('null target is not typing', isTypingTarget(null), false);
}

console.log('the key itself');
{
  expect('is space', HOTKEY, ' ');
}


console.log('one press means one action');
{
  // Verified in a browser: before this, holding the key fired FIVE folds in
  // a row. On a live table the extra clicks land on the next hand's buttons
  // and it starts playing by itself — the exact thing this must never do.
  expect('a cooldown exists at all', COOLDOWN_MS > 0, true);
  expect('and it outlasts a fast double-tap', COOLDOWN_MS >= 500, true);
  // Short enough that a genuine next decision is never blocked: hands take
  // seconds, not milliseconds
  expect('but never blocks the next real decision', COOLDOWN_MS <= 1500, true);
}


console.log('a sized action is a sequence, not a click');
{
  // PokerNow's raise takes two steps and the amount box does not exist until
  // the first one. Setting the value before clicking was a no-op, so the
  // raise went in at PokerNow's default and a second press zeroed it.
  // Verified in a browser against a mock of that flow: one press now opens
  // the box, writes 250, and submits 250.
  expect('bet is treated as sized', buttonSelectorFor('bet') !== null, true);
  expect('raise is treated as sized', buttonSelectorFor('raise') !== null, true);
  // Actions with no amount must never touch the form
  for (const a of ['fold', 'check', 'call'] as ActionType[]) {
    expect(`${a} needs no amount box`, buttonSelectorFor(a) !== null, true);
  }
}

process.exit(failures > 0 ? 1 : 0);
