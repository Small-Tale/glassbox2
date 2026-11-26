import { signal } from 'kerfjs';

import type { Definition } from './definition-navigation.js';
import type { ReviewSource } from './review-source.js';

/** HS2-E3YMJ5: the declarations of the displayed file on one side, and the jump to each. */
export type OutlineSide = 'before' | 'after';
export type OutlineSymbol = { name: string; kind: string; line: number; depth: number };
export type OutlineFile = {
  path: string;
  side: OutlineSide;
  revision: string;
  diff_revision: string;
  index: number;
  text: string;
};
export type OutlineResult =
  | { status: 'found'; file: OutlineFile; symbols: OutlineSymbol[]; truncated: boolean }
  | { status: 'unsupported' }
  | { status: 'unavailable' };
type Selection = { source: ReviewSource; index: number; path: string; revision: string };
export type OutlineNode = { id: string; symbol: OutlineSymbol; children: OutlineNode[] };

async function request({ revision, ...selection }: Selection, side: OutlineSide) {
  const response = await fetch('/api/v1/review/outline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection, revision, side }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as OutlineResult;
}

/** The sides a file has: an added file has only After and a deleted file only Before. */
export function outlineSides(status: string): OutlineSide[] {
  if (status === 'added') return ['after'];
  if (status === 'deleted') return ['before'];
  return ['before', 'after'];
}

export function outlineTree(symbols: readonly OutlineSymbol[], filter: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const open: OutlineNode[] = [];
  symbols.forEach((symbol, index) => {
    const node: OutlineNode = { id: `symbol:${index}`, symbol, children: [] };
    while ((open.at(-1)?.symbol.depth ?? -1) >= symbol.depth) open.pop();
    (open.at(-1)?.children ?? roots).push(node);
    open.push(node);
  });
  const query = filter.trim().toLocaleLowerCase();
  if (query === '') return roots;
  const keep = (nodes: OutlineNode[], inherited: boolean): OutlineNode[] =>
    nodes.flatMap((node) => {
      const matches = inherited || node.symbol.name.toLocaleLowerCase().includes(query);
      const children = keep(node.children, matches);
      return matches || children.length > 0 ? [{ ...node, children }] : [];
    });
  return keep(roots, false);
}

export function createSymbolOutline(fetchOutline = request) {
  const side = signal<OutlineSide>('after');
  const result = signal<OutlineResult | null>(null);
  const loading = signal(false);
  const error = signal('');
  const filter = signal('');
  const collapsed = signal<ReadonlySet<string>>(new Set());
  let sequence = 0;
  let loaded = '';

  /** Loads the outline for the selection and side; the same selection, revision and side is served from memory. */
  async function load(selection: Selection, wanted: OutlineSide) {
    const key = JSON.stringify([selection.source, selection.index, selection.path, selection.revision, wanted]);
    if (key === loaded && result.value !== null) return;
    const request = ++sequence;
    loaded = '';
    loading.value = true;
    error.value = '';
    result.value = null;
    try {
      const next = await fetchOutline(selection, wanted);
      if (sequence !== request) return;
      result.value = next;
      loaded = key;
    } catch (failure) {
      if (sequence === request)
        error.value = failure instanceof Error ? failure.message : 'Could not read the outline.';
    } finally {
      if (sequence === request) loading.value = false;
    }
  }

  /** The destination a chosen declaration reveals: the displayed version of the file at the declaration's line. */
  function destination(symbol: OutlineSymbol): Definition | undefined {
    const current = result.value;
    if (current?.status !== 'found') return undefined;
    return { ...current.file, diff_revision: current.file.diff_revision, line: symbol.line };
  }

  function reset() {
    sequence++;
    loaded = '';
    side.value = 'after';
    result.value = null;
    loading.value = false;
    error.value = '';
    filter.value = '';
    collapsed.value = new Set();
  }

  return { side, result, loading, error, filter, collapsed, load, destination, reset };
}

export type SymbolOutline = ReturnType<typeof createSymbolOutline>;
