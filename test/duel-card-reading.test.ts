/**
 * Reading cards off a duel.com table, and refusing to when they cannot be.
 *
 * The suit is the dangerous part. duel.com writes it nowhere — no class, no
 * data attribute, no label — so the scraper identifies it by hashing the SVG
 * path that draws it. That works until the artwork changes, and the failure
 * then is silent: every card still has a rank, every board still has five
 * cards, and every flush is invented or destroyed.
 *
 * So the rule is that an unrecognised glyph makes the card unreadable, the
 * unreadable card makes the board unreadable, and the advisor says so. These
 * tests exist to keep that rule, and they use the REAL path data copied out
 * of a live table — a fixture with invented geometry would only prove the
 * hash function agrees with itself.
 */
import { JSDOM } from 'jsdom';
import { mountTable, card, faceDownCard, HEART_PATH, CLUB_PATH } from './helpers/duel-table';

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown): void {
  const ok = actual === wanted;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: expected ${wanted}, got ${actual}`}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  mountTable(JSDOM, {});
  const { GameStateScraper } = await import('../src/content/scraper/index');
  const { suitPathHash, parseCardsCounted } = await import('../src/content/scraper/card-parser');
  const scraper = new GameStateScraper();

  console.log('\nthe suit fingerprints match the real artwork');
  {
    /**
     * The two glyphs in the fixture are the genuine `d` attributes, and the
     * hashes they produce are the ones compiled into the lookup. If the site
     * redraws its cards these stop matching and every card becomes
     * unreadable — loudly — rather than quietly changing suit.
     */
    const svg = (d: string) => {
      const dom = new JSDOM(`<svg viewBox="0 0 48 48"><path d="${d}"/></svg>`);
      return dom.window.document.querySelector('svg');
    };
    expect('hearts', suitPathHash(svg(HEART_PATH)), 1839217999);
    expect('clubs', suitPathHash(svg(CLUB_PATH)), 1979187418);
    expect('and nothing at all hashes to null', suitPathHash(null), null);
  }

  console.log('\ncards read with the right rank and suit');
  {
    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: ['10h', '2c', 'Jh'] });
    const s = scraper.scrapeNow();
    expect('ace of hearts', `${s?.holeCards[0].rank}:${s?.holeCards[0].suit}`, '14:2');
    expect('king of clubs', `${s?.holeCards[1].rank}:${s?.holeCards[1].suit}`, '13:0');
    expect('a ten is a ten, not a one', s?.communityCards[0].rank, 10);
  }

  console.log('\na glyph we do not recognise is not a suit');
  {
    // Stands in for the site redrawing its cards
    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: ['10h', '2unknown', 'Jh'] });
    expect('the board is refused rather than shortened', scraper.scrapeNow(), null);
    const failure = scraper.getFailure();
    expect('and the failure says how many were read',
      /read 2 of 3 community cards/.test(failure?.message ?? ''), true);
  }

  console.log('\nand neither is an unreadable rank');
  {
    mountTable(JSDOM, {
      hole: ['Ah', 'Kc'],
      boardHtml: card('10h') + card('h').replace('>h<', '>?<') + card('Jh'),
    });
    expect('still refused', scraper.scrapeNow(), null);
  }

  console.log('\na short board must not become an earlier street');
  {
    /**
     * This is the hazard the counting exists for. Three cards with one
     * unreadable becomes two, which reads as preflop, and the preflop
     * advisor then runs on a flop with complete confidence. Five becoming
     * four is a river priced as a turn, with draws that cannot come.
     */
    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: ['10h', '2h', 'Jh', '9c', '3unknown'] });
    const s = scraper.scrapeNow();
    expect('a river with one bad card is not a turn', s, null);
  }

  console.log('\nand a board longer than a board is refused');
  {
    // Seen live on PokerNow as two boards in one container; refused here on
    // principle, because which five of six is not a question a scraper can answer
    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: ['10h', '2h', 'Jh', '9c', '3h', '4c'] });
    expect('six cards is not a board', scraper.scrapeNow(), null);
    expect('and it says so',
      /not a board/.test(scraper.getFailure()?.message ?? ''), true);
  }

  console.log('\nface-down cards are absent, not unreadable');
  {
    /**
     * The opponent's hole cards are `.poker-card` too. They carry no rank
     * and no suit, and that is the normal state of the world — refusing a
     * scrape over them would mean never advising on anything.
     */
    mountTable(JSDOM, { hole: ['Ah', 'Kc'], board: ['10h', '2h', 'Jh'] });
    const opp = parseCardsCounted('.poker-slot--hole-opp .poker-card');
    expect('none are read', opp.cards.length, 0);
    expect('and none are counted as seen either', opp.seen, 0);
    expect('so the table still scrapes', scraper.scrapeNow() !== null, true);
  }

  console.log('\nour own cards are not confused with theirs');
  {
    mountTable(JSDOM, {
      hole: ['Ah', 'Kc'],
      holeHtml: card('Ah') + card('Kc') + faceDownCard(),
    });
    const s = scraper.scrapeNow();
    expect('a stray face-down card in our own slot is skipped',
      `${s?.holeCards[0].rank}${s?.holeCards[1].rank}`, '1413');
  }

  if (failures > 0) {
    console.error(`\n${failures} duel card-reading test(s) failed`);
    process.exit(1);
  }
  console.log('\nall duel card-reading tests passed');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
