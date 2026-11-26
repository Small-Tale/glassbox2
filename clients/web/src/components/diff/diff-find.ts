import { effect, signal } from 'kerfjs';

import type { DiffBlock } from './context-expansion.js';
import type { DiffLine } from './text-diff-model.js';

/** HS2-30ZEFE: the Find query and the match the person has stepped to; both survive a file switch's re-render. */
export function createFindState() {
  return {
    query: signal(''),
    current: signal(0),
    /** Whether the collapsible field is expanded. */
    open: signal(false),
    /** Changes when the app replaces the field's text itself (a clear), so the editor is rebuilt. */
    revision: signal(0),
  };
}

export type FindState = ReturnType<typeof createFindState>;

/** One occurrence of the query in a shown line, addressed by that line's numbers and its offset in the text. */
export type FindMatch = { before: number | null; after: number | null; start: number; length: number };

export type FindResult = {
  query: string;
  matches: readonly FindMatch[];
  /** Index of the current match, always within `matches` when there are any. */
  current: number;
};

export const noFind: FindResult = { query: '', matches: [], current: 0 };

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * Every occurrence of `query` in the lines the blocks show, in the order the lines appear in the diff (removed
 * lines before the added lines that replace them) in both layouts. A line counts once even when the split layout
 * shows it on both sides. Matching ignores case; hidden lines are not searched.
 */
export function findMatches(blocks: readonly DiffBlock[], query: string): FindMatch[] {
  if (query === '') return [];
  const pattern = new RegExp(escapePattern(query), 'giu');
  const matches: FindMatch[] = [];
  for (const block of blocks) {
    if (block.kind === 'expand') continue;
    const lines: readonly DiffLine[] = block.kind === 'hunk' ? block.hunk.lines : block.lines;
    for (const line of lines) {
      for (const found of line.text.matchAll(pattern)) {
        matches.push({ before: line.before_line, after: line.after_line, start: found.index, length: found[0].length });
      }
    }
  }
  return matches;
}

/** The matches and the current index kept within them, for a query. */
export function findResult(blocks: readonly DiffBlock[], query: string, current: number): FindResult {
  const matches = findMatches(blocks, query);
  return { query, matches, current: matches.length === 0 ? 0 : Math.min(Math.max(current, 0), matches.length - 1) };
}

/** The next or previous match index, wrapping at either end. */
export function stepMatch(count: number, current: number, direction: 1 | -1) {
  return count === 0 ? 0 : (current + direction + count) % count;
}

/** "3 of 12", "No matches", or nothing while the query is empty. */
export function findReadout({ query, matches, current }: FindResult) {
  if (query === '') return '';
  return matches.length === 0 ? 'No matches' : `${current + 1} of ${matches.length}`;
}

/** The ranges to mark in one line, with the current match flagged; empty when the line has none. */
export function lineRanges(result: FindResult, line: Pick<DiffLine, 'before_line' | 'after_line'>) {
  const ranges: { start: number; length: number; current: boolean }[] = [];
  result.matches.forEach((match, index) => {
    if (match.before === line.before_line && match.after === line.after_line) {
      ranges.push({ start: match.start, length: match.length, current: index === result.current });
    }
  });
  return ranges;
}

export type MarkedText<T> = T & { mark: 'match' | 'current' | null };

/** Split syntax tokens at the match boundaries so each piece is either wholly marked or not. */
export function markTokens<T extends { text: string }>(
  tokens: readonly T[],
  ranges: readonly { start: number; length: number; current: boolean }[],
): MarkedText<T>[] {
  if (ranges.length === 0) return tokens.map((token) => ({ ...token, mark: null }));
  const pieces: MarkedText<T>[] = [];
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    let cursor = offset;
    for (const range of ranges) {
      const from = Math.max(range.start, cursor);
      const to = Math.min(range.start + range.length, end);
      if (to <= from) continue;
      if (from > cursor) pieces.push({ ...token, text: token.text.slice(cursor - offset, from - offset), mark: null });
      pieces.push({
        ...token,
        text: token.text.slice(from - offset, to - offset),
        mark: range.current ? 'current' : 'match',
      });
      cursor = to;
    }
    if (cursor < end) pieces.push({ ...token, text: token.text.slice(cursor - offset), mark: null });
    offset = end;
  }
  return pieces;
}

/** Return to the first match whenever `result` is replaced (another file, a reload); the query stays. */
export function resetFindOnChange(find: FindState, result: { readonly value: unknown }) {
  return effect(() => {
    // Reading `result.value` subscribes the reset to every new load.
    if (Object.is(result.value, undefined)) return;
    find.current.value = 0;
  });
}
