import { signal } from 'kerfjs';

import type { TextHunk } from '../diff/text-diff-model.js';
import type { ReviewSource } from './review-source.js';

export type DefinitionSide = 'before' | 'after';
export type Definition = {
  path: string;
  side: DefinitionSide;
  revision: string;
  diff_revision: string | null;
  index: number | null;
  line: number;
  text: string;
};

type Selection = { source: ReviewSource; index: number; path: string; revision: string };
type Resolution =
  { status: 'found'; destination: Definition } | { status: 'ambiguous' | 'not_found' | 'unsupported' | 'limit' };

async function lookup(
  { revision, ...selection }: Selection,
  side: DefinitionSide,
  symbol: string,
): Promise<Resolution> {
  const response = await fetch('/api/v1/review/definition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection, revision, side, symbol }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as Resolution;
}

export function supportsDefinitions(path: string) {
  return /\.(?:rs|[jt]sx?|[mc][jt]s|pyi?)$/u.test(path);
}

export function includesDefinition(hunks: readonly TextHunk[], destination: Definition) {
  const sourceLine = destination.text.split(/\r?\n/u)[destination.line - 1];
  return hunks.some(({ lines }) =>
    lines.some((line) => line[`${destination.side}_line`] === destination.line && line.text === sourceLine),
  );
}

export function createDefinitionLookup(resolve = lookup) {
  const status = signal('');
  let sequence = 0;
  async function find(selection: Selection, side: DefinitionSide, symbol: string, current: () => boolean) {
    const request = ++sequence;
    const valid = () => sequence === request && current();
    status.value = 'Looking up definition…';
    try {
      const result = await resolve(selection, side, symbol);
      if (!valid()) return undefined;
      if (result.status === 'found') {
        status.value = '';
        return result.destination;
      }
      status.value = {
        ambiguous: `More than one definition matches ${symbol}.`,
        not_found: `No definition found for ${symbol}.`,
        unsupported: 'Definition lookup is unavailable for this comparison.',
        limit: 'Definition lookup reached the search limit.',
      }[result.status];
    } catch (failure) {
      if (valid()) status.value = failure instanceof Error ? failure.message : 'Could not look up the definition.';
    }
    return undefined;
  }
  function clear() {
    sequence++;
    status.value = '';
  }
  return { status, find, clear };
}

export function wireDefinitionNavigation(
  root: HTMLElement,
  state: ReturnType<typeof createDefinitionLookup>,
  selected: () => Selection | undefined,
  show: (destination: Definition) => Promise<void>,
) {
  const controller = new AbortController();
  const { signal } = controller;
  function modifier(event: KeyboardEvent) {
    root.toggleAttribute('data-definition-modifier', event.metaKey || event.ctrlKey);
  }
  function resetModifier() {
    root.removeAttribute('data-definition-modifier');
  }
  document.addEventListener('keydown', modifier, { signal });
  document.addEventListener('keyup', modifier, { signal });
  window.addEventListener('blur', resetModifier, { signal });
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return;
      const symbol = event.target.closest<HTMLElement>('[data-token="symbol"]')?.textContent;
      const cell = event.target.closest<HTMLElement>('.text-diff__cell');
      const selection = selected();
      if (symbol === undefined || cell === null || selection === undefined) return;
      const side = cell.dataset.afterLine === undefined ? 'before' : 'after';
      if (cell.dataset[`${side}Line`] === undefined) return;
      event.preventDefault();
      const current = () => {
        const value = selected();
        return (
          value?.source === selection.source && value.index === selection.index && value.revision === selection.revision
        );
      };
      void state.find(selection, side, symbol, current).then(async (destination) => {
        if (destination !== undefined && !signal.aborted) await show(destination);
      });
    },
    { signal },
  );
  return () => {
    controller.abort();
    resetModifier();
  };
}
