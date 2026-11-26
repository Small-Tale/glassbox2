import { effect, signal } from 'kerfjs';

import type { ReviewSource } from '../review/review-source.js';
import type { DiffLine, FileContent, TextHunk } from './text-diff-model.js';

/** Unchanged lines revealed per click, and the most one request may return (HS2-DZ8ZR6). */
export const contextStep = 20;
export const contextLimit = 500;

export type ContextLine = { text: string; ends_with_newline: boolean };
/** Which way a control grows the revealed lines, relative to the changes: above the next change or below the previous. */
export type ContextDirection = 'above' | 'below' | 'all';
/** Revealed lines at each edge of a gap: `top` follows the previous hunk, `bottom` precedes the next. */
export type GapReach = { top: number; bottom: number };

/** A run of unchanged lines between hunks, addressed by displayed-side (after) line numbers. */
export type Gap = {
  index: number;
  start: number;
  end: number;
  /** Add to an after line to get its before line. */
  delta: number;
  hasAbove: boolean;
  hasBelow: boolean;
};

export type Expansion = {
  lines: ReadonlyMap<number, ContextLine>;
  reach: ReadonlyMap<number, GapReach>;
  pending: number | null;
  error: { gap: number; message: string } | null;
};

export const noExpansion: Expansion = { lines: new Map(), reach: new Map(), pending: null, error: null };

// Git counts a zero-length side from the line before it, so its first line is one later and its last is its start.
const firstLine = (start: number, count: number) => (count === 0 ? start + 1 : start);
const lastLine = (start: number, count: number) => (count === 0 ? start : start + count - 1);

/** Unchanged runs before, between and after hunks; the trailing run needs the displayed side's line count. */
export function gapsOf(hunks: readonly TextHunk[], total: number | null | undefined): Gap[] {
  const gaps: Gap[] = [];
  for (let index = 0; index <= hunks.length; index++) {
    const previous = hunks[index - 1];
    const next = hunks[index];
    const start = previous === undefined ? 1 : lastLine(previous.after_start, previous.after_count) + 1;
    const beforeStart = previous === undefined ? 1 : lastLine(previous.before_start, previous.before_count) + 1;
    const end = next === undefined ? total : firstLine(next.after_start, next.after_count) - 1;
    if (end === null || end === undefined || end < start) continue;
    gaps.push({
      index,
      start,
      end,
      delta: beforeStart - start,
      hasAbove: next !== undefined,
      hasBelow: previous !== undefined,
    });
  }
  return gaps;
}

export function reachOf(expansion: Expansion, gap: Gap): GapReach {
  return expansion.reach.get(gap.index) ?? { top: 0, bottom: 0 };
}

export function hiddenLines(gap: Gap, reach: GapReach) {
  return gap.end - gap.start + 1 - reach.top - reach.bottom;
}

/** The displayed-side lines one control press asks for, or null when nothing is hidden or the control is unavailable. */
export function nextRange(gap: Gap, reach: GapReach, direction: ContextDirection, step = contextStep) {
  const first = gap.start + reach.top;
  const last = gap.end - reach.bottom;
  if (last < first) return null;
  if (direction === 'below') return gap.hasBelow ? { start: first, end: Math.min(first + step - 1, last) } : null;
  if (direction === 'above') return gap.hasAbove ? { start: Math.max(last - step + 1, first), end: last } : null;
  return last - first + 1 <= contextLimit ? { start: first, end: last } : null;
}

/** Record fetched lines and grow the matching edge of the gap. */
export function withRevealed(
  expansion: Expansion,
  gap: Gap,
  direction: ContextDirection,
  range: { start: number; end: number },
  fetched: readonly ContextLine[],
): Expansion {
  const lines = new Map(expansion.lines);
  fetched.forEach((line, offset) => lines.set(range.start + offset, line));
  const reach = { ...reachOf(expansion, gap) };
  if (direction === 'above') reach.bottom += fetched.length;
  else reach.top += fetched.length;
  return { lines, reach: new Map(expansion.reach).set(gap.index, reach), pending: null, error: null };
}

export type DiffBlock =
  | { kind: 'hunk'; hunk: TextHunk; header: boolean }
  | { kind: 'context'; lines: DiffLine[] }
  | { kind: 'expand'; gap: Gap; hidden: number };

/** Hunks interleaved with revealed unchanged lines and the controls that reveal more. */
export function diffBlocks(
  hunks: readonly TextHunk[],
  total: number | null | undefined,
  expansion: Expansion,
): DiffBlock[] {
  const gaps = new Map(gapsOf(hunks, total).map((gap) => [gap.index, gap]));
  const revealed = (gap: Gap, from: number, to: number): DiffBlock[] => {
    const lines: DiffLine[] = [];
    for (let number = from; number <= to; number++) {
      const line = expansion.lines.get(number);
      if (line === undefined) continue;
      lines.push({ kind: 'context', before_line: number + gap.delta, after_line: number, ...line });
    }
    return lines.length === 0 ? [] : [{ kind: 'context', lines }];
  };
  const blocks: DiffBlock[] = [];
  for (let index = 0; index <= hunks.length; index++) {
    const gap = gaps.get(index);
    let joined = false;
    if (gap !== undefined) {
      const reach = reachOf(expansion, gap);
      const hidden = hiddenLines(gap, reach);
      blocks.push(...revealed(gap, gap.start, gap.start + reach.top - 1));
      if (hidden > 0) blocks.push({ kind: 'expand', gap, hidden });
      blocks.push(...revealed(gap, gap.end - reach.bottom + 1, gap.end));
      joined = hidden === 0 || reach.bottom > 0;
    }
    const hunk = hunks[index];
    if (hunk !== undefined) blocks.push({ kind: 'hunk', hunk, header: !joined });
  }
  return blocks;
}

type Selection = { source: ReviewSource; index: number; path: string };
type ContextRange = { start: number; end: number };
type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | FileContent;
export type LoadContext = (
  selection: Selection,
  revision: string,
  range: ContextRange,
  abort: AbortSignal,
) => Promise<{ lines: ContextLine[]; total: number }>;

// The host answers 409 when the source has moved on, so lines from a changed file never join a stale diff.
async function fetchContext(selection: Selection, revision: string, range: ContextRange, abort: AbortSignal) {
  const response = await fetch('/api/v1/review/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, revision, ...range }),
    signal: abort,
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as { lines: ContextLine[]; total: number };
}

/** Revealed unchanged lines for the file on screen; call `reset` (or bind it) whenever the shown file changes. */
export function createContextExpansion(
  result: { readonly value: Loaded | null },
  selection: () => Selection | null,
  loadContext: LoadContext = fetchContext,
) {
  const expansion = signal<Expansion>(noExpansion);
  let controller = new AbortController();
  /** Collapse everything and abandon a fetch still in flight. */
  function reset() {
    controller.abort();
    controller = new AbortController();
    expansion.value = noExpansion;
  }
  async function expand(gapIndex: number, direction: ContextDirection) {
    const file = result.value;
    const target = selection();
    if (file?.kind !== 'text' || target === null || expansion.peek().pending !== null) return;
    const gap = gapsOf(file.hunks, file.after_lines).find(({ index }) => index === gapIndex);
    const range = gap === undefined ? null : nextRange(gap, reachOf(expansion.peek(), gap), direction);
    if (gap === undefined || range === null) return;
    const { signal: abort } = controller;
    expansion.value = { ...expansion.peek(), pending: gapIndex, error: null };
    try {
      const context = await loadContext(target, file.revision, range, abort);
      if (abort.aborted) return;
      expansion.value = withRevealed(expansion.peek(), gap, direction, range, context.lines);
    } catch (failure) {
      if (abort.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Could not load the unchanged lines.';
      expansion.value = { ...expansion.peek(), pending: null, error: { gap: gapIndex, message } };
    }
  }
  return { expansion, expand, reset };
}

/** Start collapsed again whenever `result` is replaced: another file, a reload or a new revision. */
export function resetContextOnChange(context: { reset: () => void }, result: { readonly value: unknown }) {
  return effect(() => {
    // Reading `result.value` subscribes the reset to every new load.
    if (Object.is(result.value, undefined)) return;
    context.reset();
  });
}
