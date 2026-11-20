import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import test from 'node:test';

import ts from 'typescript';

const catalog = JSON.parse(await readFile('component-catalog.json', 'utf8'));
const metadata = JSON.parse(await readFile('kerf.components.json', 'utf8'));

test('HS2-R1ZZ67 catalogs every production component source and its direct dependencies', async () => {
  const sources = (await readdir('src/components', { recursive: true }))
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => `src/components/${path.replaceAll('\\', '/')}`)
    .sort();
  assert.deepEqual(catalog.entries.map(({ source }) => source).sort(), sources);
  const idsByPath = new Map(catalog.entries.map(({ id, source }) => [resolve(source), id]));

  for (const { id, source, uses = [] } of catalog.entries) {
    const parsed = ts.createSourceFile(source, await readFile(source, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = new Map();
    for (const node of parsed.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      const local = idsByPath.get(resolve(source, '..', specifier.replace(/\.js$/u, '.tsx')));
      const kerf = specifier.startsWith('@kerfjs/ui/') ? specifier.slice('@kerfjs/ui/'.length) : undefined;
      const dependency = local ?? kerf;
      const bindings = node.importClause?.namedBindings;
      if (dependency === undefined || bindings === undefined || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) imports.set(item.name.text, dependency);
    }
    const actual = new Set();
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const dependency = imports.get(node.tagName.getText(parsed));
        if (dependency !== undefined) actual.add(dependency);
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.deepEqual([...uses].sort(), [...actual].sort(), id);
    const { composition, publicExports } = metadata.components.find((entry) => entry.id === id);
    const helpers = publicExports.map(({ name }) => name).filter((name) => name.startsWith('wire'));
    assert.equal(composition.wiring.required, helpers.length > 0, id);
    assert.deepEqual(composition.wiring.helpers, helpers, id);
    for (const wiring of composition.wiring.sources ?? []) {
      assert.equal(relative(resolve(source), resolve(wiring.source)), '', id);
    }
  }
});

test('HS2-RBX2HQ resolves every declared dependency in the installed or local catalog', async () => {
  const kerf = JSON.parse(await readFile('node_modules/@kerfjs/ui/ai/component-catalog.json', 'utf8'));
  const known = new Set([...catalog.entries, ...kerf.entries].map(({ id }) => id));
  for (const { uses = [] } of catalog.entries) {
    for (const id of uses) assert.ok(known.has(id), id);
  }
});
