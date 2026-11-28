import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { comparisonScenes } from './comparison-scenes.mjs';

const profiles = ['wide', 'medium', 'narrow'];
const schemes = ['light', 'dark'];
const states = ['empty', 'loading', 'error', 'populated', 'overflow'];
const required = profiles.flatMap((profile) =>
  schemes.flatMap((scheme) => states.map((state) => `${profile}/${scheme}/${state}`)),
);

const diff = ['review-tour/diff', 'review-tour/comment', 'review-tour/dark'];
const discussion = ['review-comment/comment', 'review-tour/comment', 'review-tour/dark', 'review-handoff/share'];
const analysis = ['review-analysis/risk-note'];
const components = {
  'analysis-controls': analysis,
  'media-diff': ['image-comparison/images'],
  'review-discussion': [...discussion, ...analysis],
  'share-menu': ['review-handoff/share'],
  'source-context': ['review-tour/files', 'direct-comparison/direct-diff', 'review-tour/dark'],
  'symbol-outline-dialog': ['review-outline/symbols'],
  'text-diff': [...diff, ...analysis, 'direct-comparison/direct-diff'],
};

const flows = {
  'open-working-tree': ['review-tour/files'],
  'open-staged-unstaged-commit-range-or-branch': [],
  'open-difftool-review': [],
  'compare-files-directly': ['direct-comparison/direct-diff'],
  'compare-folders-directly': [],
  'browse-changed-files': ['review-tour/files'],
  'filter-changed-files': [],
  'visit-files-with-history': [],
  'mark-file-reviewed': [],
  'read-a-split-diff': ['review-tour/diff'],
  'read-an-inline-diff': [],
  'wait-for-open-comparison': ['workbench-loading-wide-light/loading'],
  'open-an-unchanged-comparison': ['workbench-empty-wide-light/empty'],
  'handle-a-repository-open-error': ['workbench-error-wide-light/error'],
  'reveal-unchanged-context': [],
  'find-in-diff': [],
  'compare-images': ['image-comparison/images'],
  'zoom-pan-and-focus-an-image': [],
  'render-a-diagram': [],
  'jump-to-a-definition': [],
  'browse-symbol-outline': ['review-outline/symbols'],
  'follow-a-cited-commit': [],
  'order-files-by-risk': analysis,
  'order-files-by-narrative': [],
  'read-code-guidance': [],
  'choose-provider-and-model': [],
  'write-a-line-comment': discussion,
  'comment-on-an-image-region': [],
  'reply-or-resolve-a-thread': [],
  'move-or-reanchor-a-thread': [],
  'preview-or-open-an-attachment': [],
  'open-feedback-sharing': ['review-handoff/share'],
  'publish-or-send-feedback': [],
  'reopen-or-delete-a-saved-review': [],
  'manage-feedback-storage': [],
  'configure-renderers': [],
  'change-appearance': ['review-tour/dark'],
};

const frames = new Map();
for (const scene of comparisonScenes) {
  const profile = scene.viewport.width >= 1080 ? 'wide' : scene.viewport.width >= 730 ? 'medium' : 'narrow';
  let scheme = scene.scheme;
  for (const frame of scene.frames) {
    for (const step of frame.steps) if (step.action === 'appearance') scheme = step.scheme;
    frames.set(`${scene.id}/${frame.name}`, `${profile}/${scheme}/${frame.state ?? 'populated'}`);
  }
}

function componentCoverage(id) {
  const alwaysVisible = id === 'review-workbench' || id === 'review-navigator';
  const captured = alwaysVisible ? [...frames.keys()] : (components[id] ?? []);
  const evidence = new Set(captured.map((frame) => frames.get(frame)));
  return { id, captured, missing: required.filter((profile) => !evidence.has(profile)) };
}

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
const catalog = JSON.parse(await readFile(new URL('../component-catalog.json', import.meta.url), 'utf8'));
const componentRows = catalog.entries.map(({ id }) => componentCoverage(id));
const flowRows = Object.entries(flows).map(([id, captured]) => ({ id, captured }));
const unknownFrames = new Set(
  [...componentRows, ...flowRows].flatMap(({ captured }) => captured).filter((frame) => !frames.has(frame)),
);
if (unknownFrames.size > 0) throw new Error(`Coverage references missing scenes: ${[...unknownFrames].join(', ')}`);
const missing = {
  components: componentRows.filter(({ captured }) => captured.length === 0).map(({ id }) => id),
  flows: flowRows.filter(({ captured }) => captured.length === 0).map(({ id }) => id),
  componentProfiles: componentRows.reduce((total, row) => total + row.missing.length, 0),
};
console.log(JSON.stringify({ required, components: componentRows, flows: flowRows, missing }, null, 2));
if (values.check && (missing.flows.length > 0 || missing.componentProfiles > 0)) process.exitCode = 1;
