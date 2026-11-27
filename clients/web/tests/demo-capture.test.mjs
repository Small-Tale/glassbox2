import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { differingArtifacts, suiteScenes, validateScene } from '../demo-capture/scene.mjs';
import { scenes } from '../demo-capture/scenes.mjs';

const valid = () => structuredClone(scenes[0]);

test('HS2-5HS40W the shipped scenes are valid and each suite draws from the one format', () => {
  for (const scene of scenes) assert.doesNotThrow(() => validateScene(scene));
  assert.deepEqual(
    suiteScenes(scenes, 'public').map((scene) => scene.id),
    scenes.map((scene) => scene.id),
  );
  assert.deepEqual(
    suiteScenes(scenes, 'comparison').map((scene) => scene.id),
    scenes.map((scene) => scene.id),
  );
  assert.deepEqual(new Set(scenes.map((scene) => scene.kind)), new Set(['still', 'animation']));
  assert.throws(() => suiteScenes(scenes, 'private'), /unknown suite private/u);
});

test('HS2-5HS40W a scene must name its suites, window, frames and steps', () => {
  const rejects = (change, message) => {
    const scene = valid();
    change(scene);
    assert.throws(() => validateScene(scene), message);
  };
  rejects((scene) => (scene.id = 'Not Kebab'), /\.id/u);
  rejects((scene) => (scene.suites = []), /\.suites/u);
  rejects((scene) => (scene.suites = ['private']), /\.suites/u);
  rejects((scene) => (scene.kind = 'video'), /\.kind/u);
  rejects((scene) => (scene.viewport.width = 0), /viewport\.width/u);
  rejects((scene) => (scene.scheme = 'sepia'), /\.scheme/u);
  rejects((scene) => (scene.frames = []), /needs at least one frame/u);
  rejects((scene) => (scene.frames[0].ready = 'later'), /frames\[0\]\.ready/u);
  rejects((scene) => (scene.frames[0].steps[0].action = 'wait'), /action must be one of/u);
  rejects((scene) => (scene.frames[0].steps[2].line = 0), /needs a line number/u);
  rejects((scene) => (scene.frames[0].hold = -1), /hold/u);
  rejects((scene) => scene.frames.push({ ...scene.frames[0] }), /exactly one frame|unique/u);
  rejects((scene) => (scene.kind = 'animation'), /at least two frames/u);
});

test('HS2-5HS40W loading, empty and error frames are explicit opt-ins', () => {
  const scene = valid();
  scene.frames[0] = { name: 'held', state: 'loading', steps: [] };
  assert.doesNotThrow(() => validateScene(scene));
  scene.frames[0].state = 'spinner';
  assert.throws(() => validateScene(scene), /frames\[0\]\.state/u);
  // Without an opt-in state a frame must wait for a named settled state.
  scene.frames[0] = { name: 'bare', steps: [] };
  assert.throws(() => validateScene(scene), /frames\[0\]\.ready/u);
});

test('HS2-5HS40W repeated runs differ when any artifact byte differs or an artifact is missing', () => {
  const same = { 'a.png': Buffer.from('x'), 'a.svg': Buffer.from('y') };
  assert.deepEqual(differingArtifacts([same]), []);
  assert.deepEqual(differingArtifacts([same, { ...same }, { ...same }]), []);
  assert.deepEqual(differingArtifacts([same, { ...same, 'a.svg': Buffer.from('z') }]), ['a.svg']);
  assert.deepEqual(differingArtifacts([same, { 'a.png': Buffer.from('x') }]), ['a.svg']);
  assert.deepEqual(differingArtifacts([{ 'b.png': Buffer.from('x') }, same]), ['a.png', 'a.svg', 'b.png']);
});

test('HS2-5HS40W the harness never waits for a duration', async () => {
  const folder = new URL('../demo-capture/', import.meta.url);
  for (const name of (await readdir(folder)).filter((file) => file.endsWith('.mjs'))) {
    const source = await readFile(new URL(name, folder), 'utf8');
    assert.doesNotMatch(source, /waitForTimeout|setTimeout|\bsleep\b/u, `${name} waits on time`);
  }
});
