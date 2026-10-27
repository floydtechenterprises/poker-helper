import { SEL } from './scraper/selectors';
import { ActionType } from '../engine/types';

/**
 * One key to take the recommended action.
 *
 * The line this must never cross: nothing happens unless you press the key,
 * every single hand. There is no timer, no queue, and no "if my turn then
 * act" — the extension advises, and a human decides to follow it. That is
 * the difference between a tool and a bot, and it is a difference in the
 * code, not in the wording.
 *
 * PokerNow already has its own C/R/K/F shortcuts. This exists because a
 * two-minute blind level leaves no time to read a recommendation, find the
 * matching button, and type a bet size.
 */

export interface HotkeyDeps {
  /** The advice to act on, or null when there is nothing current. */
  getAdvice(): { action: ActionType; amount?: number; street: string } | null;
  /** The street the table is on right now. */
  getStreet(): string | null;
  /** Whether the table is actually waiting on us. */
  isYourTurn(): boolean;
  /** Told what happened, so the overlay can show it. */
  onResult(message: string): void;
}

export const HOTKEY = ' '; // space

/**
 * Type a number into a React-controlled input.
 *
 * Assigning `.value` updates the DOM but not React's internal state, so the
 * form submits the old value — the bet would go in at whatever was there
 * before. Setting through the native setter and firing `input` is what makes
 * React notice.
 */
export function setReactInputValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Which button on the table corresponds to an advised action.
 *
 * duel.com has three buttons, not five. Call and check are one control whose
 * text changes, and so are bet and raise — the table only ever labels the
 * aggressive one "Raise". So two pairs collapse onto one selector each.
 *
 * That makes the mapping safe in a way PokerNow's was not: there is no way to
 * aim at a CHECK button and hit a CALL, because they are the same element and
 * the table decides which it is. What the key presses is whatever the table
 * is currently offering in that slot.
 */
export function buttonSelectorFor(action: ActionType): string | null {
  switch (action) {
    case 'fold': return SEL.BTN_FOLD;
    case 'check':
    case 'call': return SEL.BTN_CALL;
    case 'bet':
    case 'raise': return SEL.BTN_RAISE;
    default: return null;
  }
}

/**
 * Is this keypress meant for us, or is the user typing?
 *
 * Firing a fold because someone pressed space in the chat box would be an
 * unforgivable way to lose a hand.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select'
    || el.isContentEditable === true;
}

/**
 * Why a press was refused, or null when it should go ahead.
 *
 * Separated out so the rules are testable without a DOM: every one of them
 * is a way to act on something stale or unasked-for.
 */
export function refuseReason(deps: HotkeyDeps): string | null {
  if (!deps.isYourTurn()) return "It's not your turn";
  const advice = deps.getAdvice();
  if (!advice) return 'No advice yet';
  // Advice from an earlier street is worse than none: the board has changed
  // underneath it and the recommendation no longer describes this spot
  const street = deps.getStreet();
  if (street && advice.street !== street) return 'Advice is from a previous street';
  if (!buttonSelectorFor(advice.action)) return `Cannot click "${advice.action}"`;
  return null;
}

/**
 * How long the key stays dead after it acts.
 *
 * One deliberate press per decision is the whole safety model, and two ways
 * of breaking it are easy to hit by accident: holding the key, and pressing
 * it twice in a second. Both were real — a held key fired five folds in a
 * row in testing, which on a live table would spill into the NEXT hand's
 * buttons and start playing by itself.
 */
export const COOLDOWN_MS = 700;

export function installHotkey(deps: HotkeyDeps): () => void {
  let lastActed = 0;
  /**
   * A raise in progress blocks another one, regardless of the cooldown.
   *
   * `completeRaise` is asynchronous: it clicks RAISE, waits up to 600ms for
   * the amount box to appear, types the size, then submits. The cooldown is
   * 700ms and starts at the keypress, so a second press can arrive while the
   * first sequence is still mid-flight — and the two then race over the same
   * input, one typing while the other submits.
   *
   * This is the one place the extension puts chips in, so it takes a flag of
   * its own rather than trusting the timings not to overlap.
   */
  let raiseInFlight = false;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== HOTKEY) return;
    // A held key repeats. Auto-repeat is the browser acting, not the user.
    if (e.repeat) { e.preventDefault(); return; }
    // Chat, the raise box, anywhere the user is typing
    if (isTypingTarget(e.target)) return;
    // A modifier means they meant something else entirely
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (Date.now() - lastActed < COOLDOWN_MS) { e.preventDefault(); return; }
    if (raiseInFlight) { e.preventDefault(); return; }

    const refused = refuseReason(deps);
    if (refused) {
      e.preventDefault();
      deps.onResult(refused);
      return;
    }

    const advice = deps.getAdvice()!;
    const selector = buttonSelectorFor(advice.action)!;
    const button = document.querySelector(selector) as HTMLElement | null;
    if (!button) {
      e.preventDefault();
      deps.onResult(`No ${advice.action.toUpperCase()} button on the table`);
      return;
    }

    e.preventDefault();
    lastActed = Date.now();

    const isSized = (advice.action === 'bet' || advice.action === 'raise')
      && !!advice.amount;

    if (!isSized) {
      button.click();
      deps.onResult(`${advice.action.toUpperCase()} — done`);
      return;
    }

    /**
     * Raising on PokerNow takes two steps, and the amount box does not exist
     * until the first one.
     *
     * Clicking RAISE opens the box; only then can a size be typed and
     * confirmed. Setting the value first was a no-op — the input was not on
     * the page yet — so the raise went in at whatever PokerNow defaulted to,
     * and pressing the key again fought with the now-open form and zeroed
     * it. One press has to drive the whole sequence.
     */
    raiseInFlight = true;
    void completeRaise(button, Math.round(advice.amount!), deps.onResult)
      .finally(() => { raiseInFlight = false; });
  };

  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

/** Wait for an element to appear, up to a limit. Null if it never does. */
export async function waitFor<T extends Element>(
  selector: string, timeoutMs = 600, stepMs = 25,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const el = document.querySelector(selector) as T | null;
    if (el) return el;
    if (Date.now() >= deadline) return null;
    await new Promise(r => setTimeout(r, stepMs));
  }
}

/**
 * Open the raise box, type the size, and confirm it.
 *
 * Submitting the form is what confirms — clicking the raise button a second
 * time is what the user hit, and it reopens or resets the box instead. The
 * amount must be written AFTER the box exists and BEFORE the submit, or
 * PokerNow sends whatever default it opened with.
 */
export async function completeRaise(
  openButton: HTMLElement,
  amount: number,
  report: (message: string) => void,
): Promise<void> {
  /**
   * On duel.com the amount box is already there.
   *
   * PokerNow needed two steps because clicking RAISE was what created the
   * input; here the box, the slider and the presets are on screen for as long
   * as a raise is on offer, so there is nothing to open and nothing to wait
   * for. If the input is missing, a raise is not actually available and
   * clicking the button would be acting on a stale reading.
   */
  const input = document.querySelector(SEL.RAISE_INPUT) as HTMLInputElement | null;
  if (!input) {
    report('No amount box on the table — raise is not available');
    return;
  }

  // The size. Through the native setter, because assigning `.value` updates
  // the DOM without telling Vue, and the form then submits the old number.
  setReactInputValue(input, String(amount));

  /**
   * Confirm by clicking the raise button itself.
   *
   * There is no form here to submit — PokerNow wrapped its sizing panel in
   * one and ignored clicks, duel.com does the opposite. A frame is left for
   * Vue to pick up the input event before the click reads the value back,
   * because the two happening in the same tick submitted the previous size.
   */
  await new Promise(r => requestAnimationFrame(() => r(null)));
  openButton.click();
  report(`RAISE ${amount} — done`);
}
