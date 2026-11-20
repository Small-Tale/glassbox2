import type { ImageRegion } from '../discussion/discussion-state.js';

export type RegionBounds = { left: number; top: number; width: number; height: number };

export const initialRegion: RegionBounds = { left: 35, top: 35, width: 30, height: 30 };

const directions = new Map([
  ['ArrowLeft', { x: -5, y: 0 }],
  ['ArrowRight', { x: 5, y: 0 }],
  ['ArrowUp', { x: 0, y: -5 }],
  ['ArrowDown', { x: 0, y: 5 }],
]);

export function changeRegion(bounds: RegionBounds, key: string, resize: boolean): RegionBounds | undefined {
  const direction = directions.get(key);
  if (direction === undefined) return undefined;
  const { left, top, width, height } = bounds;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  if (resize) {
    return {
      left,
      top,
      width: clamp(width + direction.x, 5, 100 - left),
      height: clamp(height + direction.y, 5, 100 - top),
    };
  }
  return {
    left: clamp(left + direction.x, 0, 100 - width),
    top: clamp(top + direction.y, 0, 100 - height),
    width,
    height,
  };
}

export function regionAnchor({ left, top, width, height }: RegionBounds): ImageRegion {
  return { kind: 'image_region', left: left / 100, top: top / 100, width: width / 100, height: height / 100 };
}
