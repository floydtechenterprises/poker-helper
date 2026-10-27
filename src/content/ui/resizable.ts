import { saveSettings } from '../../data/settings';

/**
 * Grab any edge or corner to resize the overlay, like an application window.
 *
 * The panel is a fixed-position box, so dragging the left or top edge has to
 * move the panel as well as change its size — otherwise the opposite edge
 * walks across the screen and the box appears to slide away from the cursor.
 * Each handle therefore declares which axes it moves and which it grows.
 */

/** Below this the advice is unreadable; the panel is not a useful sliver. */
export const MIN_WIDTH = 220;
export const MIN_HEIGHT = 120;

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const DIRECTIONS: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const CURSORS: Record<Dir, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

/**
 * Clamp a proposed geometry into something legal.
 *
 * Exported so the behaviour can be tested without a browser: every awkward
 * case (dragging past the opposite edge, off-screen, absurd sizes) is a
 * question about this function, not about the DOM.
 */
export function resolveResize(
  dir: Dir,
  start: { left: number; top: number; width: number; height: number },
  dx: number,
  dy: number,
  viewport: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  let { left, top, width, height } = start;

  if (dir.includes('e')) width = start.width + dx;
  if (dir.includes('s')) height = start.height + dy;

  // Dragging the west edge: the right edge must stay put, so the panel's
  // left moves by exactly as much as its width shrinks
  if (dir.includes('w')) {
    width = start.width - dx;
    left = start.left + dx;
  }
  if (dir.includes('n')) {
    height = start.height - dy;
    top = start.top + dy;
  }

  // Honour the minimum without letting the panel creep past the edge we
  // are anchored to — clamping width alone would do exactly that
  if (width < MIN_WIDTH) {
    if (dir.includes('w')) left = start.left + start.width - MIN_WIDTH;
    width = MIN_WIDTH;
  }
  if (height < MIN_HEIGHT) {
    if (dir.includes('n')) top = start.top + start.height - MIN_HEIGHT;
    height = MIN_HEIGHT;
  }

  // Keep it on screen
  if (left < 0) { width += left; left = 0; }
  if (top < 0) { height += top; top = 0; }
  width = Math.min(width, Math.max(MIN_WIDTH, viewport.width - left));
  height = Math.min(height, Math.max(MIN_HEIGHT, viewport.height - top));
  width = Math.max(MIN_WIDTH, width);
  height = Math.max(MIN_HEIGHT, height);

  // The minimum size and the right-hand wall can disagree: near the edge of
  // the screen there may not be MIN_WIDTH left to grow into. Slide the panel
  // back instead of letting it hang off, which is what a window manager
  // does and what keeps the advice readable. Only a viewport smaller than
  // the panel's own minimum can still overhang, and nothing can fix that.
  if (left + width > viewport.width) left = Math.max(0, viewport.width - width);
  if (top + height > viewport.height) top = Math.max(0, viewport.height - height);

  return { left, top, width, height };
}

/**
 * Returns a cleanup function, and callers must use it — see makeDraggable
 * for the same reasoning. The move and release listeners are on the document,
 * so destroying the overlay leaves them attached to a detached panel.
 */
export function makeResizable(
  panel: HTMLElement,
  onResize?: (w: number, h: number) => void,
): () => void {
  let dir: Dir | null = null;
  let startX = 0;
  let startY = 0;
  let start = { left: 0, top: 0, width: 0, height: 0 };

  for (const d of DIRECTIONS) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${d}`;
    handle.style.cursor = CURSORS[d];

    handle.addEventListener('mousedown', (e) => {
      // A collapsed panel is just a title bar — nothing to resize
      if (panel.classList.contains('collapsed')) return;

      dir = d;
      startX = e.clientX;
      startY = e.clientY;
      start = {
        left: panel.offsetLeft,
        top: panel.offsetTop,
        width: panel.offsetWidth,
        height: panel.offsetHeight,
      };
      // The panel animates its height when advice changes size; leaving that
      // on makes the box lag a frame behind the cursor while dragging
      panel.classList.add('resizing');
      e.preventDefault();
      e.stopPropagation();
    });

    panel.appendChild(handle);
  }

  const onMove = (e: MouseEvent) => {
    if (!dir) return;

    const next = resolveResize(
      dir, start, e.clientX - startX, e.clientY - startY,
      { width: window.innerWidth, height: window.innerHeight },
    );

    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.width = `${next.width}px`;
    panel.style.height = `${next.height}px`;
    // With an explicit height the body's own 500px cap would clip the
    // advice short of the panel's bottom edge
    panel.style.setProperty('--body-max-height', 'none');
  };

  const onUp = () => {
    if (!dir) return;
    dir = null;
    panel.classList.remove('resizing');

    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    onResize?.(w, h);
    saveSettings({
      overlayWidth: w,
      overlayHeight: h,
      overlayX: panel.offsetLeft,
      overlayY: panel.offsetTop,
    });
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  return () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
}
