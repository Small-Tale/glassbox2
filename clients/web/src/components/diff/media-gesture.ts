/** HS2-XJWGYD: view gestures that keep the two images of a comparison looking at the same place. */

export const minZoom = 100;
export const maxZoom = 400;
export const zoomStep = 25;

/** Where a position sits within a scrollable range, from 0 (start) to 1 (end); 0 when nothing scrolls. */
export function scrollFraction(position: number, maxScroll: number): number {
  return maxScroll <= 0 ? 0 : Math.min(1, Math.max(0, position / maxScroll));
}

/** The position that puts another scroller at the same fraction of its own range, so unequal sizes stay aligned. */
export function scrollTarget(fraction: number, maxScroll: number): number {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.round(clamped * Math.max(0, maxScroll));
}

/** The shared zoom after one wheel gesture: scrolling up zooms in, down zooms out, within the toolbar's limits. */
export function zoomForWheel(zoom: number, deltaY: number): number {
  if (deltaY === 0) return zoom;
  const next = zoom + (deltaY < 0 ? zoomStep : -zoomStep);
  return Math.min(maxZoom, Math.max(minZoom, next));
}
