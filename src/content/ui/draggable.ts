import { saveSettings } from '../../data/settings';

/**
 * Returns a cleanup function, and callers must use it.
 *
 * The move and release listeners live on `document`, not on the panel, so
 * removing the overlay from the page does not remove them. Every stop/start
 * of a session builds a new overlay and adds another pair — each closing over
 * a panel that is no longer in the document and can never be collected, and
 * each running on every mouse movement for the life of the tab.
 *
 * They do nothing visible, because the drag flag is false. That is what makes
 * it worth fixing rather than noticing.
 */
export function makeDraggable(
  panel: HTMLElement,
  handle: HTMLElement,
  onPositionChange?: (x: number, y: number) => void,
): () => void {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.header-btn')) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = panel.offsetLeft;
    startTop = panel.offsetTop;

    e.preventDefault();
  });

  const onMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    // Clamp to viewport
    newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newLeft));
    newTop = Math.max(0, Math.min(window.innerHeight - 40, newTop));

    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
  };

  const onUp = () => {
    if (!isDragging) return;
    isDragging = false;

    const x = panel.offsetLeft;
    const y = panel.offsetTop;
    onPositionChange?.(x, y);
    saveSettings({ overlayX: x, overlayY: y });
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  return () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
}
