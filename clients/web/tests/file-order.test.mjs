import assert from 'node:assert/strict';
import test from 'node:test';

import { orderFiles, riskLevel } from '../src/components/review/file-order.ts';

// HS2-5P1B23: analysis orders never hide a file.
const paths = ['a.rs', 'b.rs', 'c.rs', 'd.rs'];
const risk = (path, aggregate) => ({ path, analysis: { kind: 'risk', rationale: `why ${path}`, aggregate } });
const labels = (sections) => sections.map(({ id, entries }) => [id, entries.map(({ index }) => paths[index])]);

test('risk order lists the highest risk first and keeps the rest visible', () => {
  const sections = orderFiles(paths, 'risk', { files: [risk('b.rs', 0.2), risk('d.rs', 0.9), risk('a.rs', 0.5)] });
  assert.deepEqual(labels(sections), [
    ['ordered', ['d.rs', 'a.rs', 'b.rs']],
    ['rest', ['c.rs']],
  ]);
  assert.deepEqual(sections[0].entries[0].badge, { label: 'High Risk', tone: 'danger' });
  assert.equal(sections[0].entries[0].detail, 'why d.rs');
  assert.deepEqual(
    [0.7, 0.35, 0.34].map((value) => riskLevel(value).label),
    ['High Risk', 'Medium Risk', 'Low Risk'],
  );
});

test('equal scores fall back to path order, and a partial result lists failures apart', () => {
  const sections = orderFiles(paths, 'risk', {
    files: [risk('c.rs', 0.4), risk('a.rs', 0.4)],
    failures: [{ path: 'b.rs', message: 'The provider timed out.' }],
  });
  assert.deepEqual(labels(sections), [
    ['ordered', ['a.rs', 'c.rs']],
    ['failed', ['b.rs']],
    ['rest', ['d.rs']],
  ]);
  assert.equal(sections[1].entries[0].detail, 'The provider timed out.');
});

test('narrative order follows the steps and numbers them', () => {
  const sections = orderFiles(paths, 'narrative', {
    files: [],
    narrative: [
      { path: 'c.rs', reason: 'Start here.' },
      { path: 'gone.rs', reason: 'Not in this comparison.' },
      { path: 'a.rs', reason: 'Then this.' },
      { path: 'c.rs', reason: 'Repeated.' },
    ],
  });
  assert.deepEqual(labels(sections), [
    ['ordered', ['c.rs', 'a.rs']],
    ['rest', ['b.rs', 'd.rs']],
  ]);
  assert.deepEqual(
    sections[0].entries.map(({ badge }) => badge.label),
    ['Step 1', 'Step 2'],
  );
});

test('no result yet lists every file once, and ignored kinds do not score', () => {
  assert.deepEqual(labels(orderFiles(paths, 'risk', null)), [['rest', paths]]);
  assert.deepEqual(labels(orderFiles(paths, 'narrative', null)), [['rest', paths]]);
  const guidance = { files: [{ path: 'a.rs', analysis: { kind: 'guidance' } }] };
  assert.deepEqual(labels(orderFiles(paths, 'risk', guidance)), [['rest', paths]]);
  assert.deepEqual(labels(orderFiles([], 'risk', null)), []);
});
