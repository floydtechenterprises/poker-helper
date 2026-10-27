/**
 * The CLICK / WAIT badge.
 *
 * It exists because of something that happened in live play: the engine
 * awaits an off-thread equity calculation before rendering, so during that
 * window the PREVIOUS decision is still on screen — correctly formatted,
 * confidently stated, and about to be replaced. Pressing the hotkey on it
 * meant acting on advice for a spot that had already moved on.
 *
 * The first version then produced a second live report: it flickered "the
 * whole time". The engine re-evaluates on every DOM mutation and PokerNow
 * re-renders constantly during a turn, so nearly every recompute is a cache
 * hit finishing in a couple of milliseconds. Announcing each one made the
 * badge strobe continuously — and a warning that fires constantly is one you
 * stop reading, which defeats its only purpose.
 *
 * So WAIT is delayed and CLICK is immediate. Both behaviours are asserted
 * here, because they pull against each other: too eager and it flickers, too
 * slow and it never warns.
 *
 * Tested against a minimal element stub rather than a real DOM, matching how
 * overlay-listener-cleanup.test.ts works.
 */
import { OverlayUI } from '../src/content/ui/overlay';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

/** The one element the badge touches, with just the surface it uses. */
function fakeBadge() {
  return { textContent: '', className: '', title: '', style: { display: '' } };
}

/**
 * An overlay whose panel returns our stub for the badge selector.
 *
 * Only `showDecisionState` is exercised, so the rest of the panel can be
 * absent — the method must not depend on anything it does not query.
 */
function overlayWith(badge: ReturnType<typeof fakeBadge> | null) {
  const ui = Object.create(OverlayUI.prototype) as any;
  ui.decisionStateTimer = null;
  ui.panel = {
    querySelector: (sel: string) => (sel === '.decision-state' ? badge : null),
  };
  return ui as OverlayUI;
}

/** Longer than the badge's own delay, so a scheduled WAIT has landed. */
const AFTER_DELAY = 260;
const settle = () => new Promise(r => setTimeout(r, AFTER_DELAY));

async function main(): Promise<void> {
  console.log('CLICK and hidden are immediate');
  {
    const badge = fakeBadge();
    const ui = overlayWith(badge);

    ui.showDecisionState(true);
    check('settled says CLICK', badge.textContent === 'CLICK', badge.textContent);
    check('and is marked ready', badge.className.includes('ready'));
    check('and is visible', badge.style.display === '');

    ui.showDecisionState(null);
    check('not our turn hides it at once', badge.style.display === 'none');
  }

  console.log('a fast recompute never shows WAIT — the reported flicker');
  {
    const badge = fakeBadge();
    const ui = overlayWith(badge);

    ui.showDecisionState(true);      // settled
    ui.showDecisionState(false);     // a recompute begins
    check('WAIT is not shown immediately', badge.textContent === 'CLICK',
      `showed "${badge.textContent}" the instant a recompute began — this is the flicker`);

    ui.showDecisionState(true);      // and finishes quickly
    check('and never appears at all', badge.textContent === 'CLICK');

    // A burst, as a real turn produces
    for (let i = 0; i < 50; i++) {
      ui.showDecisionState(false);
      ui.showDecisionState(true);
    }
    check('fifty fast recomputes leave it steady', badge.textContent === 'CLICK',
      `ended on "${badge.textContent}" after a burst of re-renders`);
    check('and it is never marked thinking',
      !badge.className.includes('thinking'),
      'the pulse animation would have been running the whole turn');

    // Nothing may fire late either
    await settle();
    check('and no delayed WAIT arrives afterwards', badge.textContent === 'CLICK',
      `a stale timer fired and set "${badge.textContent}" after everything settled`);
  }

  console.log('a genuinely slow recompute does warn');
  {
    const badge = fakeBadge();
    const ui = overlayWith(badge);
    ui.showDecisionState(true);
    ui.showDecisionState(false);

    await settle();
    check('WAIT appears once the wait is real', badge.textContent === 'WAIT',
      `still showed "${badge.textContent}" — the warning would never fire at all`);
    check('and is marked thinking', badge.className.includes('thinking'));
    check('and is visible', badge.style.display === '');

    ui.showDecisionState(true);
    check('and clears the moment it settles', badge.textContent === 'CLICK');
    check('with the pulse stopped', !badge.className.includes('thinking'),
      `className "${badge.className}" — it would keep pulsing on settled advice`);
  }

  console.log('a pending WAIT is cancelled, not merely overwritten');
  {
    const badge = fakeBadge();
    const ui = overlayWith(badge);
    ui.showDecisionState(false);     // schedules WAIT
    ui.showDecisionState(null);      // the turn ends before it fires

    await settle();
    check('the hidden state survives the stale timer',
      badge.style.display === 'none',
      'a scheduled WAIT fired after the turn ended and made the badge reappear');
  }

  console.log('the tooltip always describes the state shown');
  {
    const badge = fakeBadge();
    const ui = overlayWith(badge);

    ui.showDecisionState(true);
    const settledTitle = badge.title;
    ui.showDecisionState(false);
    await settle();
    check('it changes with the state', badge.title !== settledTitle,
      'the same tooltip on both states — it would describe the wrong one half the time');
    check('and the thinking one warns it may change',
      /change/i.test(badge.title), badge.title);
  }

  console.log('a missing panel is survivable');
  {
    const ui = Object.create(OverlayUI.prototype) as any;
    ui.panel = null;
    ui.decisionStateTimer = null;
    let threw = false;
    try { ui.showDecisionState(true); } catch { threw = true; }
    check('no panel does not throw', !threw,
      'the badge crashed the advice path when the overlay was closed');

    // A panel without the element — an older overlay left in the page
    let threw2 = false;
    try { overlayWith(null).showDecisionState(true); } catch { threw2 = true; }
    check('a panel without the badge does not throw', !threw2);
  }

  if (failures > 0) {
    console.error(`\n${failures} decision-state test(s) failed`);
    process.exit(1);
  }
  console.log('\nall decision-state tests passed');
}

main();
