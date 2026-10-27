/**
 * A 'turn' event must mean the action buttons changed, and nothing else.
 *
 * The decisions observer resolved `.poker-actions` once at start-up and
 * watched it. On duel.com that container is ABSENT whenever it is not our
 * turn, so at the start of almost every session it found nothing and fell
 * back to `document.body` — then reported every mutation anywhere on the
 * page as 'turn', which outranks every other event in the debounce.
 *
 * The controller let 'turn' skip its "is it actually our turn" guard, on the
 * PokerNow assumption that the event was trustworthy. So chips sliding into
 * the pot re-ran the whole engine while the opponent was still deciding, and
 * the panel changed its advice mid-action.
 */
import { JSDOM } from 'jsdom';
import { mountTable, tableHtml } from './helpers/duel-table';
import type { GameEvent } from '../src/content/scraper/observers';

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown): void {
  const ok = actual === wanted;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: expected ${wanted}, got ${actual}`}`);
  if (!ok) failures++;
}

/** jsdom gives us a real MutationObserver; the scraper expects it global. */
function mount(spec: Parameters<typeof mountTable>[1]): void {
  mountTable(JSDOM, spec);
  (globalThis as any).MutationObserver = (globalThis as any).window.MutationObserver;
  (globalThis as any).Node = (globalThis as any).window.Node;
}

async function main(): Promise<void> {
  mount({});
  const { GameObserver } = await import('../src/content/scraper/observers');

  /** Everything delivered in the window after `mutate` runs. */
  async function eventsFrom(mutate: () => void): Promise<GameEvent[]> {
    const obs = new GameObserver();
    const seen: GameEvent[] = [];
    obs.start(e => seen.push(e));
    mutate();
    await new Promise(r => setTimeout(r, 400));
    obs.stop();
    return seen;
  }

  const notOurTurn = {
    hole: ['Kh', '10h'],
    board: ['3h', '2c', '8h'],
    pot: '262',
    seats: [
      { name: 'Villain', stack: '4,869' },
      { name: 'Hero', stack: '4,869', isSelf: true },
    ],
  };

  console.log('\nordinary table movement is not a turn');
  {
    mount(notOurTurn);
    const doc = (globalThis as any).document as Document;
    const events = await eventsFrom(() => {
      // The pot being paid out: a childList change inside the table, which
      // is exactly what used to be delivered as 'turn'
      const pot = doc.querySelector('.poker-center__potrow .poker-chipstack')!;
      pot.innerHTML = '<span class="poker-chipstack__amount">Pot: 524</span>';
    });

    expect('something was delivered', events.length > 0, true);
    expect('but not as a turn', events.includes('turn'), false);
    expect('it is a state change', events[0], 'state-change');
  }

  console.log('\nmovement outside the table is not an event at all');
  {
    mount(notOurTurn);
    const doc = (globalThis as any).document as Document;
    const events = await eventsFrom(() => {
      // The blind-up clock ticking: inside the shell, outside the table.
      // Previously 'turn', because document.body was being watched.
      const surface = doc.querySelector('.play-surface')!;
      const banner = doc.createElement('div');
      banner.className = 'poker-blindsup';
      banner.textContent = 'Increase to 30/60 in 4 min';
      surface.appendChild(banner);
    });

    expect('nothing is delivered', events.length, 0);
  }

  console.log('\nthe buttons arriving is a turn');
  {
    mount(notOurTurn);
    const doc = (globalThis as any).document as Document;
    const events = await eventsFrom(() => {
      const surface = doc.querySelector('.play-surface')!;
      const panel = doc.createElement('div');
      panel.className = 'poker-actions';
      panel.innerHTML = '<button class="poker-btn poker-btn--fold">'
        + '<span class="poker-btn__text">Fold</span></button>';
      surface.appendChild(panel);
    });

    expect('delivered as a turn', events.includes('turn'), true);
  }

  console.log('\nthe buttons arriving inside a wrapper is still a turn');
  {
    mount(notOurTurn);
    const doc = (globalThis as any).document as Document;
    const events = await eventsFrom(() => {
      // Vue mounts the panel inside its own wrapper, so the added node is
      // not itself `.poker-actions` — `closest` alone would miss this
      const surface = doc.querySelector('.play-surface')!;
      const wrapper = doc.createElement('div');
      wrapper.innerHTML = '<div class="poker-actions">'
        + '<button class="poker-btn poker-btn--call">'
        + '<span class="poker-btn__text">Check</span></button></div>';
      surface.appendChild(wrapper);
    });

    expect('delivered as a turn', events.includes('turn'), true);
  }

  console.log('\nthe buttons leaving is a turn too');
  {
    // Our turn ending is the edge the controller repaints to "waiting" on,
    // so it has to be delivered — a removal used to be ignored entirely
    mount({
      ...notOurTurn,
      seats: [
        { name: 'Villain', stack: '4,869' },
        { name: 'Hero', stack: '4,869', isSelf: true, isActor: true },
      ],
      actions: { fold: true, call: 'Check', raise: true },
    });
    const doc = (globalThis as any).document as Document;
    expect('the panel is there to begin with',
      doc.querySelector('.poker-actions') !== null, true);

    const events = await eventsFrom(() => {
      doc.querySelector('.poker-actions')!.remove();
    });

    expect('delivered as a turn', events.includes('turn'), true);
  }

  console.log('\na button being disabled mid-turn is a turn');
  {
    mount({
      ...notOurTurn,
      seats: [
        { name: 'Villain', stack: '4,869' },
        { name: 'Hero', stack: '4,869', isSelf: true, isActor: true },
      ],
      actions: { fold: true, call: 'Check', raise: true },
    });
    const doc = (globalThis as any).document as Document;
    const events = await eventsFrom(() => {
      doc.querySelector('.poker-btn--raise')!.className = 'poker-btn poker-btn--raise is-disabled';
    });

    expect('delivered as a turn', events.includes('turn'), true);
  }

  console.log('\nthe fixture really does leave the buttons out when it is not our turn');
  {
    // Guards the premise of every case above: if the helper always rendered
    // a panel, none of this would be testing what it claims to
    const html = tableHtml(notOurTurn as any);
    expect('no actions container', html.includes('poker-actions'), false);
  }
}

main().then(() => {
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall turn-event tests passed');
});
