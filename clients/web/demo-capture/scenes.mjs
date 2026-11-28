// HS2-5HS40W: the sample scenes. The public showcase and the comparison suite draw from this one format.

import { validateScene } from './scene.mjs';

const window1440 = { width: 1440, height: 900 };

export const scenes = [
  {
    id: 'review-comment',
    title: 'A text diff with one comment',
    suites: ['public', 'comparison'],
    kind: 'still',
    viewport: window1440,
    scheme: 'light',
    frames: [
      {
        name: 'comment',
        ready: 'comment-saved',
        steps: [
          { action: 'open-comparison' },
          { action: 'select-file', name: 'review.ts' },
          { action: 'comment', line: 3, text: 'Resolved notes should stay visible until the author confirms.' },
        ],
      },
    ],
  },
  {
    id: 'review-analysis',
    title: 'Risk-ordered files with a cited AI note',
    suites: ['public', 'comparison'],
    kind: 'still',
    viewport: window1440,
    scheme: 'light',
    analysis: 'fixture',
    frames: [
      {
        name: 'risk-note',
        ready: 'analysis-note',
        steps: [
          { action: 'open-comparison' },
          { action: 'widen-file-rail' },
          { action: 'order-files', order: 'narrative' },
          { action: 'order-files', order: 'risk' },
          { action: 'select-file', name: 'review.ts' },
          { action: 'open-ai-note' },
        ],
      },
    ],
  },
  {
    id: 'review-tour',
    title: 'From a comparison to a commented line, then dark',
    suites: ['public', 'comparison'],
    kind: 'animation',
    viewport: window1440,
    scheme: 'light',
    frames: [
      { name: 'files', ready: 'review', hold: 2000, steps: [{ action: 'open-comparison' }] },
      { name: 'diff', ready: 'diff', hold: 3000, steps: [{ action: 'select-file', name: 'review.ts' }] },
      {
        name: 'comment',
        ready: 'comment-saved',
        hold: 3900,
        steps: [{ action: 'comment', line: 3, text: 'Resolved notes should stay visible until the author confirms.' }],
      },
      { name: 'dark', ready: 'comment-saved', hold: 2700, steps: [{ action: 'appearance', scheme: 'dark' }] },
    ],
  },
  {
    id: 'direct-comparison',
    title: 'Compare two files without a Git repository',
    suites: ['public', 'comparison'],
    kind: 'still',
    viewport: window1440,
    scheme: 'light',
    frames: [
      {
        name: 'direct-diff',
        ready: 'diff',
        steps: [{ action: 'open-direct-comparison' }, { action: 'select-file', name: 'release-notes.txt' }],
      },
    ],
  },
  {
    id: 'image-comparison',
    title: 'Compare the before and after of an SVG',
    suites: ['public', 'comparison'],
    kind: 'still',
    viewport: window1440,
    scheme: 'light',
    frames: [
      {
        name: 'images',
        ready: 'media',
        steps: [{ action: 'open-comparison' }, { action: 'select-file', name: 'mark.svg' }],
      },
    ],
  },
  {
    id: 'review-outline',
    title: 'Find a declaration in the selected file',
    suites: ['public', 'comparison'],
    kind: 'still',
    viewport: window1440,
    scheme: 'light',
    frames: [
      {
        name: 'symbols',
        ready: 'outline',
        steps: [
          { action: 'open-comparison' },
          { action: 'select-file', name: 'review.ts' },
          { action: 'open-outline' },
        ],
      },
    ],
  },
  {
    id: 'review-handoff',
    title: 'Copy a review instruction or send feedback to Hot Sheet 2',
    suites: ['public', 'comparison'],
    kind: 'still',
    viewport: window1440,
    scheme: 'light',
    frames: [
      {
        name: 'share',
        ready: 'share-menu',
        steps: [
          { action: 'open-comparison' },
          { action: 'select-file', name: 'review.ts' },
          { action: 'comment', line: 3, text: 'Show the resolved notes in the summary until the author confirms.' },
          { action: 'open-share-menu' },
        ],
      },
    ],
  },
].map(validateScene);
