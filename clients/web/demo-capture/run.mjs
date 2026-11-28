// HS2-5HS40W: `npm run demo:capture -- --suite comparison --runs 3`
//
// Runs each scene of a suite N times on fresh hosts and browsers, fails when any artifact differs between runs, and
// otherwise writes the artifacts to the output folder (default `demo-output/<suite>`, which is never committed).

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { defaultArchiveRoot, recordArchive } from './archive.mjs';
import { runRepeatedScene } from './capture.mjs';
import { comparisonScenes } from './comparison-scenes.mjs';
import { root } from './host.mjs';
import { differingArtifacts, showcaseArtifact, suiteNames, suiteScenes } from './scene.mjs';
import { scenes } from './scenes.mjs';

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'public' },
    scene: { type: 'string' },
    runs: { type: 'string', default: '3' },
    out: { type: 'string' },
    showcase: { type: 'boolean', default: false },
    version: { type: 'string' },
    'archive-root': { type: 'string' },
  },
});

const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
if (values.showcase && values.suite !== 'public') throw new Error('--showcase requires --suite public');
if (values.version !== undefined && (values.suite !== 'comparison' || values.out !== undefined || runs < 2)) {
  throw new Error('--version requires the comparison suite, at least two runs, and the archive output directory');
}
if (values['archive-root'] !== undefined && values.version === undefined) {
  throw new Error('--archive-root requires --version');
}
let selected = suiteScenes(values.suite === 'comparison' ? comparisonScenes : scenes, values.suite);
if (values.scene) selected = selected.filter((scene) => scene.id === values.scene);
if (selected.length === 0) {
  throw new Error(`no scene ${values.scene ?? ''} in suite ${values.suite}; suites are ${suiteNames.join(' and ')}`);
}
async function capture(out) {
  await mkdir(out, { recursive: true });
  let failed = false;
  for (const scene of selected) {
    const results = await runRepeatedScene(scene, runs);
    const differing = differingArtifacts(results);
    if (differing.length > 0) {
      failed = true;
      console.error(`${scene.id}: not deterministic across ${runs} runs: ${differing.join(', ')}`);
      continue;
    }
    const names = values.showcase ? [showcaseArtifact(scene)] : Object.keys(results[0]);
    for (const name of names) await writeFile(join(out, name), results[0][name]);
    console.log(`${scene.id}: ${runs} identical runs, ${names.length} artifacts`);
  }
  return failed ? null : selected.map(({ id }) => id);
}

if (values.version === undefined) {
  process.exitCode = (await capture(resolve(values.out ?? join('demo-output', values.suite)))) === null ? 1 : 0;
} else {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const source = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
  const recorded = await recordArchive(values['archive-root'] ?? defaultArchiveRoot, values.version, source, capture);
  if (recorded) console.log(`Archived comparison captures as ${values.version}`);
  process.exitCode = recorded ? 0 : 1;
}
