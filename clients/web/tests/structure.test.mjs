import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('the application ownership directories exist', async () => {
  for (const name of ['app', 'components', 'features', 'platform', 'shared', 'ux-demo/demos']) {
    assert.equal((await stat(resolve('src', name))).isDirectory(), true, name);
  }
});

test('HS2-8QJ9NY keeps one Lucide comparison toolbar across viewport sizes', async () => {
  const mock = await readFile(new URL('../src/design-mock/main.tsx', import.meta.url), 'utf8');
  const toolbar = mock.split('mainToolbar={{')[1]?.split('main={<Diff />}')[0] ?? '';
  assert.match(toolbar, /responsive: 'wrap'/);
  assert.doesNotMatch(toolbar, /mainHeader|size="compact"/);
  for (const action of ['split', 'inline', 'wrap', 'risk', 'guidance']) {
    const controls = [
      ...toolbar.matchAll(new RegExp(`<ToolbarButton\\s+action="${action}"[\\s\\S]*?/>\\s*}\\s*/>`, 'g')),
    ];
    assert.equal(controls.length, 1, action);
    assert.match(controls[0][0], /ariaLabel=/);
    assert.match(controls[0][0], /icon=\{<LucideIcon/);
  }
});

test('the Glassbox catalog publishes a grouped demo for every custom component', async () => {
  const catalog = JSON.parse(await readFile(new URL('../component-catalog.json', import.meta.url), 'utf8'));
  const registry = await readFile(new URL('../src/ux-demo/catalog.ts', import.meta.url), 'utf8');
  assert.ok(catalog.entries.length > 0);
  for (const { id, source, demoSource } of catalog.entries) {
    assert.match(source, /^src\/components\/[^/]+\/[^/]+\.tsx$/);
    assert.match(demoSource, /^src\/ux-demo\/demos\/[^/]+\/[^/]+\.tsx$/);
    const demo = await readFile(new URL(`../${demoSource}`, import.meta.url), 'utf8');
    assert.ok(demo.includes(`'data-demo': '${id}'`), id);
    assert.ok(registry.includes(`'${id}':`), id);
  }
});

test('HS2-533A50 application source never selects Kerf’s private .kui-* classes', async () => {
  const offenders = [];
  for (const entry of await readdir(resolve('src'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:css|tsx?)$/.test(entry.name)) continue;
    const path = resolve(entry.parentPath, entry.name);
    if (/\.kui-[a-z]/.test(await readFile(path, 'utf8'))) offenders.push(path);
  }
  assert.deepEqual(offenders, [], 'Use a public prop or app-owned class such as mainPane.contentClassName');
});
