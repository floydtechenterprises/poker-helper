/**
 * A blind extension has to say it is blind.
 *
 * Both scrape methods wrapped everything in `catch { return null }`, and
 * every health check runs off a successfully scraped state — so the one
 * failure mode nothing watched was the scrape itself failing. A PokerNow
 * markup change made a reader throw, the extension read nothing from then
 * on, and the health dot stayed green from the last good hand.
 *
 * That is the same silent-failure shape as every serious bug in this
 * project: names unreadable for hours, the profile map empty every hand.
 */
import { scrapeFailureIssues, SCRAPE_FAILURE_THRESHOLD, healthLevel } from '../src/content/health';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const fail = (consecutive: number, message = 'x.querySelector is not a function') =>
  ({ message, consecutive });

console.log('isolated misses stay quiet');
{
  // PokerNow re-renders seats during deal and showdown animations; a single
  // miss is normal and must not cry wolf
  expect('a healthy scraper reports nothing', scrapeFailureIssues(null).length, 0);
  expect('one failure is not an alarm', scrapeFailureIssues(fail(1)).length, 0);
  expect(`${SCRAPE_FAILURE_THRESHOLD - 1} failures still quiet`,
    scrapeFailureIssues(fail(SCRAPE_FAILURE_THRESHOLD - 1)).length, 0);
}

console.log('a sustained run is reported as an error');
{
  const issues = scrapeFailureIssues(fail(SCRAPE_FAILURE_THRESHOLD));
  expect('the threshold trips it', issues.length, 1);
  expect('and it is an error, not a warning', issues[0].severity, 'error');
  expect('which turns the indicator red', healthLevel(issues), 'broken');
  expect('it says the table cannot be read',
    issues[0].message.includes("Can't read the table"), true);
  expect('it includes the underlying reason',
    issues[0].message.includes('querySelector'), true);
  expect('and tells the user what to do', typeof issues[0].fix, 'string');
}

console.log('the count keeps climbing and stays reported');
{
  const many = scrapeFailureIssues(fail(500));
  expect('still exactly one issue, not 500', many.length, 1);
  expect('and it quotes how long it has been broken',
    many[0].message.includes('500'), true);
}

console.log('recovery clears it');
{
  // recordSuccess() sets the failure back to null, which is this input
  expect('a recovered scraper is silent again', scrapeFailureIssues(null).length, 0);
}

console.log('a non-Error throw is still reportable');
{
  const odd = scrapeFailureIssues({ message: 'undefined', consecutive: 10 });
  expect('does not crash on a weird message', odd.length, 1);
  expect('and stays an error', odd[0].severity, 'error');
}

process.exit(failures > 0 ? 1 : 0);
