/**
 * Player names come from the table and end up inside HTML attributes.
 *
 * There were two escape implementations. The popup's was built from the DOM:
 *
 *     div.textContent = s; return div.innerHTML;
 *
 * which escapes `&`, `<` and `>` and leaves quotes alone — correct for text,
 * wrong for attributes. And the popup interpolates names into attributes:
 *
 *     `<button data-analyse="${escapeHtml(p.name)}">`
 *
 * So an opponent who names themselves `" onmouseover="alert(1)` closes the
 * attribute and adds an event handler to a chrome-extension:// page with
 * access to storage and tabs. Nothing between the table and the popup looks
 * at that string.
 *
 * The overlay's version escaped double quotes but not single ones — safe only
 * because every attribute there happens to use double quotes, which is not a
 * property anyone should have to verify before writing markup.
 */
import { escapeHtml } from '../src/shared/escape';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

console.log('\nquotes cannot escape an attribute');
{
  const evil = '" onmouseover="alert(1)';
  const out = escapeHtml(evil);
  expectTrue('no bare double quote survives', !out.includes('"'), out);
  expectTrue('and the attribute stays closed',
    !`<b data-x="${out}">`.match(/data-x="[^"]*"\s+\w+=/), `<b data-x="${out}">`);

  const single = "' onfocus='alert(1)";
  expectTrue('single quotes too', !escapeHtml(single).includes("'"), escapeHtml(single));
}

console.log('\ntags cannot be introduced');
{
  const out = escapeHtml('<img src=x onerror=alert(1)>');
  expectTrue('no angle brackets', !out.includes('<') && !out.includes('>'), out);
}

console.log('\nordinary names round-trip readably');
{
  expect('a plain name', escapeHtml('noob'), 'noob');
  expect('spaces are fine', escapeHtml('Big Gelp'), 'Big Gelp');
  expect('an ampersand', escapeHtml('A&B'), 'A&amp;B');
  // Escaping must happen once, not twice
  expect('already-escaped text is not double-escaped by accident',
    escapeHtml('&'), '&amp;');
}

console.log('\nnon-strings do not crash the render');
{
  expect('null', escapeHtml(null as unknown as string), '');
  expect('undefined', escapeHtml(undefined as unknown as string), '');
  expect('a number', escapeHtml(42 as unknown as string), '42');
}

console.log('\nthe overlay and the popup share one implementation');
{
  // Both import from shared/escape — a second copy is how the two drifted
  const { escapeHtml: fromComponents } = require('../src/content/ui/components') as
    { escapeHtml: (s: string) => string };
  expect('the overlay re-exports the shared function',
    fromComponents('" x'), escapeHtml('" x'));
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall escaping tests passed');
