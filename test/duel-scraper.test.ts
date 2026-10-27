/**
 * Reading a duel.com table, driven through the scraper's own entry points.
 *
 * Every fixture here is built from markup observed on a live table, and the
 * numbers in the first case are a hand that actually happened: hole cards
 * 2♠ J♠, board A♠ 8♣ 8♦, pot 824, with Check on offer. The suits differ here
 * only because the fixture carries the two glyphs whose path data was
 * captured — which suit a card is does not change any of the arithmetic.
 */
import { JSDOM } from 'jsdom';
import { mountTable } from './helpers/duel-table';

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown): void {
  const ok = actual === wanted;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: expected ${wanted}, got ${actual}`}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  mountTable(JSDOM, {});
  const { GameStateScraper } = await import('../src/content/scraper/index');
  const scraper = new GameStateScraper();

  console.log('\nan ordinary flop with action on us');
  {
    mountTable(JSDOM, {
      hole: ['2c', 'Jc'],
      board: ['Ac', '8c', '8h'],
      pot: '824',
      dealer: 'opponent',
      actions: { fold: true, call: 'Check', raise: true },
    });
    const s = scraper.scrapeNow();
    expect('it reads', s !== null, true);
    expect('two hole cards', s?.holeCards.length, 2);
    expect('three community cards', s?.communityCards.length, 3);
    expect('which is the flop', s?.street, 'flop');
    expect('the pot', s?.pot, 824);
    expect('our stack', s?.yourStack, 9364);
    expect('two players', s?.players.length, 2);
    expect('the opponent has the button', s?.dealerSeatIndex, 0);
  }

  console.log('\nthe pot is the label PLUS the bets in front of players');
  {
    /**
     * The label counts collected chips only. On a live table it read
     * "Pot: 14" with 30 and 60 still out, and the chips only added up to the
     * table total once both were counted. Reading the label alone halves
     * every price, which turns folds into calls.
     */
    mountTable(JSDOM, {
      hole: ['Ac', 'Kc'],
      pot: '14',
      seats: [
        { name: 'Villain', stack: '6,379', bet: '30' },
        { name: 'Hero', stack: '3,517', isSelf: true, isActor: true, bet: '60' },
      ],
      actions: { fold: true, call: 'Call', callAmount: '30', raise: true },
    });
    const s = scraper.scrapeNow();
    expect('collected plus both bets', s?.pot, 104);
    expect('and our own bet is attributed to us', s?.yourCurrentBet, 60);
  }

  console.log('\ncheck and call are the same button');
  {
    mountTable(JSDOM, {
      hole: ['Ac', 'Kc'], board: ['2h', '7c', '9h'], pot: '100',
      actions: { fold: true, call: 'Check', raise: true },
    });
    const checking = scraper.scrapeNow();
    expect('nothing to call when it says Check', checking?.costToCall, 0);
    expect('and checking is offered', checking?.availableActions.includes('check'), true);
    expect('while calling is not', checking?.availableActions.includes('call'), false);

    mountTable(JSDOM, {
      hole: ['Ac', 'Kc'], board: ['2h', '7c', '9h'], pot: '100',
      actions: { fold: true, call: 'Call', callAmount: '50', raise: true },
    });
    const calling = scraper.scrapeNow();
    expect('the amount is read when it says Call', calling?.costToCall, 50);
    expect('and calling is offered', calling?.availableActions.includes('call'), true);
  }

  console.log('\nnot our turn means no buttons at all');
  {
    // They are absent rather than disabled, so an empty list is honest
    mountTable(JSDOM, { hole: ['Ac', 'Kc'], board: ['2h', '7c', '9h'], pot: '100' });
    const s = scraper.scrapeNow();
    expect('nothing is on offer', s?.availableActions.length, 0);
    expect('and nothing is owed', s?.costToCall, 0);
  }

  console.log('\nthe blinds come from the chips that are posted');
  {
    // Before anyone acts the only chips out ARE the blinds
    mountTable(JSDOM, {
      hole: ['Ac', 'Kc'], board: [], pot: '0',
      seats: [
        { name: 'Villain', stack: '9,900', bet: '50' },
        { name: 'Hero', stack: '9,800', isSelf: true, isActor: true, bet: '100' },
      ],
      actions: { fold: true, call: 'Call', callAmount: '50', raise: true },
    });
    const s = scraper.scrapeNow();
    expect('big blind', s?.bigBlind, 100);
    expect('small blind', s?.smallBlind, 50);
    expect('and it is reported as actually read', s?.blindSource, 'read');
  }

  console.log("\nand once the board is out, from the raise button's own arithmetic");
  {
    /**
     * The button quotes the all-in figure twice, in chips and in blinds, so
     * one divided by the other is the level. It is the only source left once
     * the posted blinds have been swept into the pot.
     */
    mountTable(JSDOM, {
      hole: ['Ac', 'Kc'], board: ['2h', '7c', '9h'], pot: '300',
      actions: { fold: true, call: 'Call', callAmount: '50', raise: true },
      allIn: { chips: '3,346.00', bb: '55.8' },
    });
    const s = scraper.scrapeNow();
    const bb = Math.round(s?.bigBlind ?? 0);
    expect('60, within rounding of 3346/55.8', bb, 60);
  }

  console.log('\nan unreadable blind stays unread rather than becoming 1');
  {
    /**
     * A big blind of 1 is a real number that every size is then measured
     * against. Zero means unknown, and `sanitizeAmount` floors a bet at one
     * chip instead of dividing by it.
     *
     * A FRESH scraper, deliberately. The one above has read a blind and
     * remembers it, which is the whole point of `lastBlinds` — a table that
     * has shown its blinds once should not forget them the moment the chips
     * are swept in. This case is about a table that has never shown them.
     */
    mountTable(JSDOM, {
      hole: ['Ac', 'Kc'], board: ['2h', '7c', '9h'], pot: '300',
      actions: { fold: true, call: 'Call', callAmount: '50', raise: true },
    });
    const s = new GameStateScraper().scrapeNow();
    expect('no blind is invented', s?.bigBlind, 0);
    expect('and it says the reading is a default', s?.blindSource, 'default');
  }

  console.log('\nwe are not in the hand without cards');
  {
    mountTable(JSDOM, { hole: [], board: ['2h', '7c', '9h'], pot: '100' });
    expect('no state', scraper.scrapeNow(), null);
    expect('but the table still reads', scraper.scrapeTableNow() !== null, true);
  }

  console.log('\nthe button is read from the modifier, not from containment');
  {
    mountTable(JSDOM, { hole: ['Ac', 'Kc'], dealer: 'hero' });
    expect('ours is seat 1', scraper.scrapeNow()?.dealerSeatIndex, 1);
  }

  if (failures > 0) {
    console.error(`\n${failures} duel scraper test(s) failed`);
    process.exit(1);
  }
  console.log('\nall duel scraper tests passed');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
