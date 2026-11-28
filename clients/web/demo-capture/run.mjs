// HS2-5HS40W: `npm run demo:capture -- --suite comparison --runs 3`
//
// Runs each scene of a suite N times on fresh hosts and browsers, fails when any artifact differs between runs, and
// otherwise writes the artifacts to the output folder (default `demo-output/<suite>`, which is never committed).

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { runRepeatedScene } from './capture.mjs';
import { differingArtifacts, showcaseArtifact, suiteNames, suiteScenes } from './scene.mjs';
import { scenes } from './scenes.mjs';

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'public' },
    scene: { type: 'string' },
    runs: { type: 'string', default: '3' },
    out: { type: 'string' },
    showcase: { type: 'boolean', default: false },
  },
});

const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
if (values.showcase && values.suite !== 'public') throw new Error('--showcase requires --suite public');
let selected = suiteScenes(scenes, values.suite);
if (values.scene) selected = selected.filter((scene) => scene.id === values.scene);
if (selected.length === 0) {
  throw new Error(`no scene ${values.scene ?? ''} in suite ${values.suite}; suites are ${suiteNames.join(' and ')}`);
}
const out = resolve(values.out ?? join('demo-output', values.suite));
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
  console.log(`${scene.id}: ${runs} identical runs, ${names.length} artifacts in ${out}`);
}
process.exitCode = failed ? 1 : 0;
