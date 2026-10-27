/**
 * Where the blind level comes from, and what must not be mistaken for it.
 *
 * The numbers here are a hand that actually happened. Heads-up on the button
 * the hero held K♦T♦ at 25/50, the advisor correctly said "raise to 125", the
 * hero raised to 125 — and the panel then re-read the felt, found 50 and 125
 * sitting in front of the two players with no board out, and called that a
 * 50/125 blind level. A 2.5bb open off 125 is 312.5, rounded to the new
 * "small blind" of 50, which is the RAISE 300 that appeared on screen.
 *
 * The empty board was being used to mean "nobody has acted yet". It does not:
 * preflop raises happen on an empty board too.
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
  const { readBlinds, readBlindsFromPosts, readBigBlindFromRaiseButton } =
    await import('../src/content/scraper/table-reader');
  const { GameStateScraper } = await import('../src/content/scraper/index');

  console.log('\nblinds as posted, before anyone has acted');
  {
    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      pot: '0',
      seats: [
        { name: 'Villain', stack: '4,975', bet: '50' },
        { name: 'Hero', stack: '4,975', isSelf: true, bet: '25' },
      ],
    });
    expect('the larger post is the big blind', readBlindsFromPosts().bigBlind, 50);
    expect('and the smaller is the small blind', readBlindsFromPosts().smallBlind, 25);
  }

  console.log('\nthe hand that produced RAISE 300');
  {
    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      pot: '12',
      dealer: 'hero',
      seats: [
        { name: 'Villain', stack: '4,944', bet: '50' },
        // The hero has opened to 125 over the 50 big blind
        { name: 'Hero', stack: '4,869', isSelf: true, bet: '125' },
      ],
    });
    expect('50 and 125 are not a blind level', readBlindsFromPosts().bigBlind, 0);
    expect('and no small blind is invented either', readBlindsFromPosts().smallBlind, 0);

    /**
     * Nothing else can see the level at this instant — it is not our turn,
     * so there is no raise button to divide. Saying so is the right answer:
     * the scraper falls back to the last level it genuinely read, and the
     * health panel only complains when there has never been one.
     */
    expect('and nothing fills the gap with a guess', readBlinds().bigBlind, 0);

    const fresh = new GameStateScraper();
    const s = fresh.scrapeNow();
    expect('a table read for the first time here has no level', s?.bigBlind, 0);
    expect('and says so rather than claiming it was read', s?.blindSource, 'default');
  }

  console.log('\nequal posts are a limp, not a level');
  {
    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      pot: '0',
      seats: [
        { name: 'Villain', stack: '4,950', bet: '50' },
        { name: 'Hero', stack: '4,950', isSelf: true, bet: '50' },
      ],
    });
    expect('50 against 50 is rejected', readBlindsFromPosts().bigBlind, 0);
  }

  console.log('\nthe raise button outranks the felt');
  {
    /**
     * The ratio test has one known gap: an open to exactly twice the big
     * blind looks like a level. 50 posted against an open to 100 reads as
     * 50/100, which is wrong by a factor of two.
     *
     * That gap is closed by precedence rather than by a cleverer reading of
     * the chips. The button states the all-in figure in chips and in blinds
     * at once, so the table is doing the division for us — 5,000.00 shown as
     * 100.0BB is a 50 big blind, whatever is sitting on the felt. And it is
     * on screen exactly when a size has to be computed, which is the only
     * moment the number is load-bearing.
     */
    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      pot: '25',
      seats: [
        { name: 'Villain', stack: '4,950', bet: '50' },
        { name: 'Hero', stack: '4,900', isSelf: true, isActor: true, bet: '100' },
      ],
      actions: { fold: true, call: 'Call', callAmount: '50', raise: true },
      allIn: { chips: '5,000.00', bb: '100.0' },
    });

    expect('the button divides out to the real level', readBigBlindFromRaiseButton(), 50);
    expect('the felt would have said 100', readBlindsFromPosts().bigBlind, 100);
    expect('and the button wins', readBlinds().bigBlind, 50);
    expect('with the small blind implied from it', readBlinds().smallBlind, 25);
  }

  console.log('\na level once read survives a street that cannot show it');
  {
    const scraper = new GameStateScraper();

    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      pot: '0',
      seats: [
        { name: 'Villain', stack: '4,975', bet: '50' },
        { name: 'Hero', stack: '4,975', isSelf: true, bet: '25' },
      ],
    });
    expect('read preflop from the posts', scraper.scrapeNow()?.bigBlind, 50);

    // The flop: the posts are swept into the pot and it is not our turn, so
    // neither source exists. This is where the panel used to declare every
    // bet size wrong.
    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      board: ['3h', '2c', '8h'],
      pot: '262',
      seats: [
        { name: 'Villain', stack: '4,869' },
        { name: 'Hero', stack: '4,869', isSelf: true },
      ],
    });
    const flop = scraper.scrapeNow();
    expect('still known on the flop', flop?.bigBlind, 50);
    expect('marked as carried, not freshly read', flop?.blindSource, 'last-read');

    /**
     * And the panel must not call that broken.
     *
     * The health check was fed `trustedBigBlind`, which is 0 for anything
     * not read on this very scrape — so on every flop it announced in red
     * that every bet size was wrong, while the engine was sizing off a level
     * it had read correctly seconds earlier. A warning that fires when
     * nothing is wrong is the one failure this module's own comments keep
     * coming back to: it teaches you to ignore the indicator.
     */
    const { checkHealth } = await import('../src/content/health');
    const issues = checkHealth({
      players: flop!.players.map(p => ({
        name: p.name, stack: p.stack, isYou: p.isYou, isActive: p.isActive,
      })),
      pot: flop!.pot,
      bigBlind: flop!.bigBlind,
      communityCardCount: flop!.communityCards.length,
      haveHoleCards: true,
      yourTurn: false,
      availableActions: [],
      mappings: {},
      learningEnabled: false,
      learningLoaded: false,
      dealerSeatKnown: true,
    });
    expect('so the panel stays quiet about the blinds',
      issues.some(i => i.code === 'blinds-unreadable'), false);

    // ...but a table where no level has EVER been read still says so
    const neverRead = checkHealth({
      players: [], pot: 0, bigBlind: 0, communityCardCount: 0,
      haveHoleCards: false, yourTurn: false, availableActions: [],
      mappings: {}, learningEnabled: false, learningLoaded: false,
    });
    expect('while a genuinely unknown level is still reported',
      neverRead.some(i => i.code === 'blinds-unreadable'), true);
  }
}

main().then(() => {
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall blind-source tests passed');
});
