/**
 * Escape text for insertion into HTML — including into attributes.
 *
 * There were two implementations of this, and they disagreed in a way that
 * mattered. The popup built its escape from the DOM:
 *
 *     const div = document.createElement('div');
 *     div.textContent = s;
 *     return div.innerHTML;
 *
 * That escapes `&`, `<` and `>` and leaves quotes alone, because inside text
 * a quote needs no escaping. The popup then interpolated the result into
 * ATTRIBUTES:
 *
 *     `<button data-analyse="${escapeHtml(p.name)}">`
 *
 * So a player who names themselves `" onmouseover="alert(1)` closes the
 * attribute and adds an event handler. The name arrives from the table, the
 * popup runs on a chrome-extension:// origin with access to storage and
 * tabs, and nothing in between inspects it.
 *
 * One function, escaping quotes as well, used by both the overlay and the
 * popup. The overlay's own version already escaped double quotes but not
 * single ones — safe only because every attribute there happens to use
 * double quotes, which is not a property anyone should have to verify before
 * writing markup.
 */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
