import { ActionType } from '../../engine/types';
import { SEL } from './selectors';
import { isHeroToAct } from './player-reader';

const text = (el: Element | null | undefined): string => (el?.textContent || '').trim();

function isEnabled(el: Element | null): boolean {
  if (!el) return false;
  const btn = el as HTMLButtonElement;
  if (btn.disabled) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

/**
 * What the table is offering right now.
 *
 * Two things make this different from the PokerNow reader.
 *
 * First, **the buttons are absent when it is not our turn**, not disabled. So
 * an empty list genuinely means "nothing is being asked of us" rather than
 * "everything is greyed out", and there is no need to tell those apart.
 *
 * Second, **call and check are the same button.** `.poker-btn--call` reads
 * "Call" with an amount beside it, or "Check" with nothing. Its presence says
 * only that continuing is possible; the text says whether that costs
 * anything. Reading the button without its text would report a call on every
 * free check, and price a free card as though it had to be paid for.
 */
export function readAvailableActions(): ActionType[] {
  const actions: ActionType[] = [];

  /**
   * Nothing is on offer unless the table is waiting on us.
   *
   * "The buttons are absent when it is not our turn" is true of the live
   * action row, but not of everything shaped like it: while someone else is
   * deciding, duel.com offers a pre-select control for queuing an action
   * ("Check/Fold"). Reading that as an offer says it is our turn when it is
   * not, and prices a queued intention as a decision in front of us.
   *
   * `.poker-seat--self.poker-seat--actor` was confirmed on a live table to
   * track the action row exactly, and it cannot be confused with a control
   * that is about a later street. It is the gate; the buttons then say what
   * the offer IS.
   */
  if (!isHeroToAct()) return actions;

  if (isEnabled(document.querySelector(SEL.BTN_FOLD))) actions.push('fold');

  const call = document.querySelector(SEL.BTN_CALL);
  if (isEnabled(call)) {
    actions.push(/check/i.test(text(call!.querySelector(SEL.BTN_TEXT))) ? 'check' : 'call');
  }

  if (isEnabled(document.querySelector(SEL.BTN_RAISE))) {
    // The engine treats bet and raise as the same verb and resolves whichever
    // the table names; duel.com only ever labels it "Raise"
    actions.push('raise');
  }

  return [...new Set(actions)];
}

/**
 * Is a decision actually ours?
 *
 * Derived from the seat rather than from the buttons, for the reason above:
 * the pre-select control exists precisely when it is NOT our turn, so
 * counting buttons answered yes at the one moment the question matters.
 */
export function isYourTurn(): boolean {
  return isHeroToAct();
}

/**
 * Is the table showing a bet-sizing panel? On duel.com, never.
 *
 * This exists because PokerNow hides FOLD and CHECK behind a sizing panel
 * the moment you click BET or RAISE. `readAvailableActions` then honestly
 * reported that checking was unavailable, and the engine — told it could no
 * longer check — changed its mind: a CHECK recommendation flipped to BET the
 * instant the user opened the panel to look at it. Nothing about the poker
 * had changed, so the controller freezes the advice while the panel is open.
 *
 * duel.com has no such panel. The amount box, the slider and the presets sit
 * alongside the buttons the whole time a raise is on offer, and opening them
 * is not a state at all. So there is nothing to freeze on, and this is
 * constantly false.
 *
 * Kept rather than deleted because the controller's freeze is still correct
 * behaviour in principle, and a site that does hide its buttons would want it
 * back. Returning false is the honest answer here, not a stub.
 */
export function isChoosingAmount(): boolean {
  return false;
}
