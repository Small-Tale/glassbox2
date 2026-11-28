import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { archivePath, compareArchives, recordArchive } from '../demo-capture/archive.mjs';
import { comparisonScenes } from '../demo-capture/comparison-scenes.mjs';
import { suiteScenes } from '../demo-capture/scene.mjs';

const source = { commit: 'a'.repeat(40), dirty: false };
const archive = (root, version, artifacts) =>
  recordArchive(root, version, source, async (folder) => {
    for (const [name, bytes] of Object.entries(artifacts)) await writeFile(join(folder, name), bytes);
    return ['fixture'];
  });

test('HS2-5TFS63 compares version archives and detects changed, added and removed files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'glassbox-archives-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await archive(root, 'v2.0.0-alpha.1', { 'before.png': 'a', 'shared.svg': 'b' }), true);
  assert.equal(await archive(root, 'v2.0.0-alpha.2', { 'after.png': 'a', 'shared.svg': 'c' }), true);
  const version = 'v2.0.0-alpha.1';
  const candidate = 'v2.0.0-alpha.2';
  const compare = (current) => compareArchives(root, version, current);
  assert.deepEqual(await compare(candidate), {
    baseline: { version, source, selection: ['fixture'] },
    current: { version: candidate, source, selection: ['fixture'] },
    added: ['after.png'],
    removed: ['before.png'],
    changed: ['shared.svg'],
  });
  const equal = await compare(version);
  assert.deepEqual([equal.added, equal.removed, equal.changed], [[], [], []]);
  await assert.rejects(() => compare('missing'), /is missing/u);
  const manifestFile = join(root, candidate, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  await writeFile(manifestFile, JSON.stringify({ ...manifest, platform: 'different-platform' }));
  await assert.rejects(() => compare(candidate), /same platform/u);
  await writeFile(join(root, candidate, 'shared.svg'), 'changed after recording');
  await assert.rejects(() => compare(candidate), /differs from its manifest/u);
});

test('HS2-5TFS63 preserves an existing archive and discards a failed repeat', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'glassbox-archives-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const version of ['', '.', '..', '../outside', 'v2/more', 'v2\\more', 'x'.repeat(81)]) {
    assert.throws(() => archivePath(root, version), /version label/u);
  }
  await archive(root, 'version-one', { 'one.png': 'original' });
  await assert.rejects(() => archive(root, 'version-one', { 'one.png': 'replacement' }), /already exists/u);
  assert.equal(await readFile(join(root, 'version-one', 'one.png'), 'utf8'), 'original');
  const result = await recordArchive(root, 'inconsistent', source, async (folder) => {
    await writeFile(join(folder, 'partial.png'), 'partial');
    return null;
  });
  assert.equal(result, false);
  assert.deepEqual(await readdir(root), ['version-one']);
});

test('HS2-5TFS63 reports unmapped states and keeps internal scenes out of the showcase', async () => {
  const program = fileURLToPath(new URL('../demo-capture/coverage.mjs', import.meta.url));
  const strict = spawnSync(process.execPath, [program, '--check'], { encoding: 'utf8' });
  assert.equal(strict.status, 1, strict.stderr);
  const coverage = JSON.parse(strict.stdout);
  assert(coverage.missing.components.includes('storage-dialog'));
  assert(coverage.missing.flows.includes('follow-a-cited-commit'));
  assert(coverage.missing.componentProfiles > 0);
  const workbench = coverage.components.find(({ id }) => id === 'review-workbench');
  assert(workbench.captured.includes('workbench-error-narrow-dark/error'));
  assert(!workbench.missing.includes('narrow/dark/error'));
  assert(workbench.missing.includes('narrow/dark/overflow'));
  assert(!suiteScenes(comparisonScenes, 'public').some(({ id }) => id.startsWith('workbench-')));
});
