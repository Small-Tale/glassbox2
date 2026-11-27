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
    id: 'review-tour',
    title: 'From a comparison to a commented line, then dark',
    suites: ['public', 'comparison'],
    kind: 'animation',
    viewport: window1440,
    scheme: 'light',
    frames: [
      { name: 'files', ready: 'review', steps: [{ action: 'open-comparison' }] },
      { name: 'diff', ready: 'diff', steps: [{ action: 'select-file', name: 'review.ts' }] },
      {
        name: 'comment',
        ready: 'comment-saved',
        steps: [{ action: 'comment', line: 3, text: 'Resolved notes should stay visible until the author confirms.' }],
      },
      { name: 'dark', ready: 'comment-saved', steps: [{ action: 'appearance', scheme: 'dark' }] },
    ],
  },
].map(validateScene);
