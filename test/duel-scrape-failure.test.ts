/**
 * The scraper reads untrusted markup, and its failure mode is silence.
 *
 * Every serious bug this project has had was quiet: the advice stayed
 * confident and plausible while the input behind it was wrong. So a scrape
 * that cannot be trusted has to SAY so — `getFailure` is what the health
 * check reads, and a reader that returns null without recording anything
 * leaves the indicator green while the extension sees nothing.
 *
 * The hostile cases are not hypothetical markup: player names are typed by
 * strangers, and chip values are rendered by a site that can change them.
 */
import { JSDOM } from 'jsdom';
import { mountTable, card } from './helpers/duel-table';

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown): void {
  const ok = actual === wanted;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: expected ${wanted}, got ${actual}`}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  mountTable(JSDOM, {});
  const { GameStateScraper } = await import('../src/content/scraper/index');

  console.log('\na page with no seats is broken, not empty');
  {
    const scraper = new GameStateScraper();
    const dom = new JSDOM('<body><div class="game-shell"><div class="poker-table"></div></div></body>');
    (globalThis as any).document = dom.window.document;
    expect('the table read is refused', scraper.scrapeTableNow(), null);
    expect('and it says there are no seats',
      /no player seats/.test(scraper.getFailure()?.message ?? ''), true);
  }

  console.log('\nrepeated failures are counted, not just flagged');
  {
    /**
     * One miss is normal — the site re-renders during deals and showdowns.
     * A run of them is what a markup change looks like, so the count is the
     * thing the health check can actually threshold on.
     */
    const scraper = new GameStateScraper();
    const dom = new JSDOM('<body><div class="poker-table"></div></body>');
    (globalThis as any).document = dom.window.document;
    scraper.scrapeTableNow();
    scraper.scrapeTableNow();
    scraper.scrapeTableNow();
    expect('three in a row', scraper.getFailure()?.consecutive, 3);
  }

  console.log('\nand a good read clears the record');
  {
    const scraper = new GameStateScraper();
    const broken = new JSDOM('<body><div class="poker-table"></div></body>');
    (globalThis as any).document = broken.window.document;
    scraper.scrapeTableNow();
    expect('failing', scraper.getFailure() !== null, true);

    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: ['2h', '7c', '9h'], pot: '100' });
    scraper.scrapeTableNow();
    expect('and recovered', scraper.getFailure(), null);
  }

  console.log('\nhostile names do not break the read');
  {
    /**
     * Names are chosen by strangers, and a name that looks like markup is
     * exactly the input that finds a place where something concatenates.
     *
     * Set as textContent rather than interpolated into the fixture's HTML,
     * because that is how the site renders it: Vue binds the name as text,
     * so a player cannot inject elements by renaming themselves. Building
     * the fixture by string concatenation instead would only prove that
     * THIS FILE is careless, which it was on the first attempt — the markup
     * in the name tore the fixture apart and produced a real script element.
     */
    mountTable(JSDOM, {
      hole: ['Ah', 'Kc'], pot: '100',
      seats: [
        { name: 'villain', stack: '1,000' },
        { name: 'hero', stack: '2,000', isSelf: true, isActor: true },
      ],
    });
    const names = document.querySelectorAll('.poker-seat__name');
    names[0].textContent = '<img src=x onerror=alert(1)>';
    names[1].textContent = '"></div><script>bad()</script>';

    const s = new GameStateScraper().scrapeNow();
    expect('the name is read back verbatim, as text',
      s?.players[0].name, '<img src=x onerror=alert(1)>');
    expect('it still reads', s !== null, true);
    expect('both seats', s?.players.length, 2);
    expect('stacks are unaffected', s?.yourStack, 2000);
    expect('and no script element was created',
      document.querySelectorAll('script').length, 0);
  }

  console.log('\nchip values that are not numbers read as zero, not as NaN');
  {
    /**
     * A NaN propagates all the way to the screen — "Pot odds: NaN%" — and a
     * NaN pot with an empty stack throws outright. Zero is wrong but finite,
     * and the engine already refuses a table whose numbers are not finite.
     */
    mountTable(JSDOM, {
      hole: ['Ah', 'Kc'], pot: 'who knows',
      seats: [
        { name: 'V', stack: '—' },
        { name: 'H', stack: 'n/a', isSelf: true, isActor: true, bet: 'lots' },
      ],
    });
    const s = new GameStateScraper().scrapeNow();
    expect('the pot is a number', Number.isFinite(s?.pot), true);
    expect('the stack is a number', Number.isFinite(s?.yourStack), true);
    expect('and our bet is a number', Number.isFinite(s?.yourCurrentBet), true);
  }

  console.log('\na board with no cards at all is preflop, not a failure');
  {
    const scraper = new GameStateScraper();
    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: [], pot: '0' });
    expect('it reads as preflop', scraper.scrapeNow()?.street, 'preflop');
    expect('with nothing recorded against it', scraper.getFailure(), null);
  }

  console.log('\nthe raise box offering no minimum is not an error');
  {
    // duel.com's input has no min attribute at all; sanitizeAmount's
    // no-limit rule is the only source of a legal floor, by design
    mountTable(JSDOM, {
      hole: ['Ah', 'Kc'], board: ['2h', '7c', '9h'], pot: '100',
      actions: { fold: true, call: 'Call', callAmount: '50', raise: true },
    });
    const s = new GameStateScraper().scrapeNow();
    expect('it reports no minimum', s?.minRaise, 0);
    expect('and the scrape is otherwise fine', s !== null, true);
  }

  if (failures > 0) {
    console.error(`\n${failures} duel scrape-failure test(s) failed`);
    process.exit(1);
  }
  console.log('\nall duel scrape-failure tests passed');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
