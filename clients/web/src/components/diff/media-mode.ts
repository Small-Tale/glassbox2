import type { MediaSides } from './text-diff-model.js';

export type MediaMode = 'split' | 'stack' | 'before' | 'after' | 'difference' | 'slice' | 'metadata' | 'source';

type Candidate = { source?: string } | null;

/** Whether an image comparison mode can show this pair of images (HS2-Q3X4BX). */
export function modeAvailable(mode: MediaMode, images: MediaSides<Candidate>): boolean {
  const both = images.before !== null && images.after !== null;
  if (mode === 'source') return images.before?.source !== undefined || images.after?.source !== undefined;
  if (mode === 'before' || mode === 'after') return images[mode] !== null;
  return both || mode === 'split' || mode === 'metadata';
}

/**
 * Keep the chosen mode and orientation when the next image supports it, otherwise fall back to
 * Side by Side, which every pair can show.
 */
export function modeForImages(mode: MediaMode, images: MediaSides<Candidate>): { mode: MediaMode; fellBack: boolean } {
  return modeAvailable(mode, images) ? { mode, fellBack: false } : { mode: 'split', fellBack: true };
}
