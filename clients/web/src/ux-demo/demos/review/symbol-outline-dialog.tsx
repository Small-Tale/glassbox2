import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { Text } from '@kerfjs/ui/text';
import { signal } from 'kerfjs';

import type { Definition } from '../../../components/review/definition-navigation.js';
import {
  createSymbolOutline,
  type OutlineResult,
  type OutlineSide,
} from '../../../components/review/symbol-outline.js';
import {
  SymbolOutlineAction,
  SymbolOutlineDialog,
  wireSymbolOutline,
} from '../../../components/review/symbol-outline-dialog.js';

const symbols = [
  { name: 'ReviewTarget', kind: 'interface', line: 3, depth: 0 },
  { name: 'ReviewSession', kind: 'class', line: 8, depth: 0 },
  { name: 'open', kind: 'method', line: 11, depth: 1 },
  { name: 'close', kind: 'method', line: 19, depth: 1 },
  { name: 'createSession', kind: 'function', line: 27, depth: 0 },
];
const text = Array.from({ length: 30 }, (_, index) => `// line ${index + 1}`).join('\n');
const file = (side: OutlineSide) => ({
  path: 'src/session.ts',
  side,
  revision: `sha-${side}`,
  diff_revision: 'diff',
  index: 0,
  text,
});
const found = (side: OutlineSide, shift = 0): OutlineResult => ({
  status: 'found',
  file: file(side),
  symbols: symbols.map((symbol) => ({ ...symbol, line: symbol.line + shift })),
  truncated: false,
});

type Fixture = {
  id: string;
  label: string;
  status: string;
  path: string;
  outline: (side: OutlineSide) => OutlineResult;
};
const fixtures: Fixture[] = [
  // The declarations sit two lines lower After, as they would once a header was added.
  {
    id: 'demo-outline-both',
    label: 'Both Sides',
    status: 'modified',
    path: 'src/session.ts',
    outline: (side) => found(side, side === 'after' ? 2 : 0),
  },
  {
    id: 'demo-outline-added',
    label: 'Added File',
    status: 'added',
    path: 'src/session.ts',
    outline: (side) => found(side),
  },
  {
    id: 'demo-outline-unsupported',
    label: 'Unsupported Language',
    status: 'modified',
    path: 'docs/notes.md',
    outline: () => ({ status: 'unsupported' }),
  },
  {
    id: 'demo-outline-empty',
    label: 'No Declarations',
    status: 'modified',
    path: 'src/empty.ts',
    outline: (side) => ({ status: 'found', file: file(side), symbols: [], truncated: false }),
  },
];
const revealed = signal('Nothing revealed yet.');
const states = fixtures.map((fixture) => ({
  ...fixture,
  state: createSymbolOutline((_, side) => Promise.resolve(fixture.outline(side))),
}));

export function SymbolOutlineDialogDemo() {
  return (
    <CatalogExampleStack label="Symbol Outline" rootAttributes={{ 'data-demo': 'symbol-outline-dialog' }}>
      <CatalogExample label="Toolbar Button" viewport={{ width: 'control' }}>
        <SymbolOutlineAction id="demo-outline-action" enabled />
        <SymbolOutlineAction id="demo-outline-action-off" enabled={false} />
      </CatalogExample>
      {states.map(({ id, label, state, path, status }) => (
        <CatalogExample label={label} viewport={{ width: 'full' }}>
          <SymbolOutlineDialog id={id} state={state} path={path} status={status} embedded />
        </CatalogExample>
      ))}
      <Text role="status" tone="quiet" rootAttributes={{ 'data-demo-revealed': '' }}>
        {revealed.value}
      </Text>
    </CatalogExampleStack>
  );
}

export function wireSymbolOutlineDemo(root: HTMLElement) {
  const stops = states.map(({ id, state, path, status }) => {
    const selection = {
      source: { kind: 'git' as const, directory: '.', mode: { kind: 'working_tree' as const } },
      index: 0,
      path,
      revision: 'diff',
      status,
    };
    void state.load(selection, 'after');
    return wireSymbolOutline(
      root,
      id,
      state,
      () => selection,
      (destination: Definition) => {
        revealed.value = `Revealed ${destination.path} on the ${destination.side} side at line ${destination.line}.`;
        return Promise.resolve();
      },
    );
  });
  return () => {
    for (const stop of stops) stop();
    for (const { state } of states) state.reset();
    revealed.value = 'Nothing revealed yet.';
  };
}
