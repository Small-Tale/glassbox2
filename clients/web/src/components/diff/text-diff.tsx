import './text-diff.css';

import { deviceClass } from '@kerfjs/ui/device-class';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { type SafeHtml, signal } from 'kerfjs';
import { Columns2, Rows2, WrapText } from 'lucide';

import type { Definition } from '../review/definition-navigation.js';
import { ContextExpander } from './context-expander.js';
import { type ContextDirection, type DiffBlock, diffBlocks, type Expansion } from './context-expansion.js';
import { type FindResult, lineRanges, markTokens } from './diff-find.js';
import { type DiffLine, splitLines, syntaxTokens, type TextHunk } from './text-diff-model.js';
import { toolsCollapseBelow } from './toolbar-collapse.js';

const device = deviceClass();

/** `null` is automatic: side by side, except inline where one pane shows at a time (GB2-8T670B). */
export function createTextDiffState() {
  return {
    layout: signal<'split' | 'inline' | null>(null),
    wrap: signal(true),
  };
}

type TextDiffState = ReturnType<typeof createTextDiffState>;

/** The layout in effect: the person's choice, or inline on a handset or portrait tablet and split otherwise. */
export function effectiveLayout(state: TextDiffState): 'split' | 'inline' {
  return state.layout.value ?? (device.value.compact ? 'inline' : 'split');
}

export function TextDiffToolbar({ id, state }: { id: string; state: TextDiffState }) {
  return (
    <>
      <ToolbarControlGroup label="Diff Layout" content="icon" hideBelow={toolsCollapseBelow}>
        <ToolbarButton
          action={`${id}:split`}
          pressed={effectiveLayout(state) === 'split'}
          ariaLabel="Side by Side"
          title="Side by Side"
          icon={<LucideIcon icon={Columns2} name="columns-2" />}
        />
        <ToolbarButton
          action={`${id}:inline`}
          pressed={effectiveLayout(state) === 'inline'}
          ariaLabel="Inline"
          title="Inline"
          icon={<LucideIcon icon={Rows2} name="rows-2" />}
        />
      </ToolbarControlGroup>
      <ToolbarControlGroup label="Line Wrapping" content="icon" hideBelow={toolsCollapseBelow}>
        <ToolbarButton
          action={`${id}:wrap`}
          pressed={state.wrap.value}
          ariaLabel="Wrap"
          title="Wrap"
          icon={<LucideIcon icon={WrapText} name="wrap-text" />}
        />
      </ToolbarControlGroup>
    </>
  );
}

type LineControl = (side: 'before' | 'after', line: number) => SafeHtml;
type RowContent = (before: number | null | undefined, after: number | null | undefined) => SafeHtml;

function DiffCell({
  line,
  side,
  path,
  lineControl,
  symbols = false,
  definition,
  find,
}: {
  line?: DiffLine;
  find?: FindResult;
  lineControl?: LineControl;
  side: 'before' | 'after' | 'both';
  path: string;
  symbols?: boolean;
  definition?: Definition;
}) {
  if (line === undefined)
    return <div class="text-diff__cell" data-change="blank" data-side={side} aria-hidden="true" />;
  const mark = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '';
  const before = side === 'after' ? null : line.before_line;
  const after = side === 'before' ? null : line.after_line;
  return (
    <div
      class="text-diff__cell"
      data-change={line.kind}
      data-before-line={before ?? undefined}
      data-after-line={after ?? undefined}
      data-side={side}
      data-definition-target={
        definition !== undefined && (definition.side === 'before' ? before : after) === definition.line ? '' : undefined
      }
    >
      {side === 'after' ? null : (
        <span class="text-diff__number" aria-label={before === null ? undefined : `Before line ${before}`}>
          {before}
          {before === null ? null : lineControl?.('before', before)}
        </span>
      )}
      {side === 'before' ? null : (
        <span class="text-diff__number" aria-label={after === null ? undefined : `After line ${after}`}>
          {after}
          {after === null ? null : lineControl?.('after', after)}
        </span>
      )}
      <span class="text-diff__marker">{mark}</span>
      <code>
        {markTokens(syntaxTokens(line.text, path, symbols), find === undefined ? [] : lineRanges(find, line)).map(
          (token) =>
            token.mark === null ? (
              <span data-token={token.kind}>{token.text}</span>
            ) : (
              <mark data-find={token.mark}>
                <span data-token={token.kind}>{token.text}</span>
              </mark>
            ),
        )}
        {line.ends_with_newline ? null : (
          <span class="text-diff__marker" title="No newline at end of file">
            {' '}
            ∅
          </span>
        )}
      </code>
    </div>
  );
}

function range(start: number, count: number) {
  return count === 1 ? String(start) : `${start},${count}`;
}

export function TextDiff({
  hunks,
  path,
  state,
  lineControl,
  rowContent,
  symbols = false,
  definition,
  snapshot = false,
  context,
  find,
}: {
  hunks: readonly TextHunk[];
  /** Unchanged-line controls and revealed lines; absent for a diff that cannot fetch more (HS2-DZ8ZR6). */
  context?: { id: string; total: number | null | undefined; expansion: Expansion };
  /** Marks the Find matches in the lines shown (HS2-30ZEFE). */
  find?: FindResult;
  path: string;
  state: TextDiffState;
  lineControl?: LineControl;
  rowContent?: RowContent;
  symbols?: boolean;
  definition?: Definition;
  snapshot?: boolean;
}) {
  if (snapshot && definition !== undefined) {
    const lines = definition.text.split(/\r?\n/u);
    const terminated = definition.text.endsWith('\n');
    if (terminated) lines.pop();
    const start = Math.max(0, definition.line - 41);
    const excerpt = lines.slice(start, definition.line + 40);
    return (
      <div
        class="text-diff"
        data-layout="inline"
        data-snapshot=""
        data-wrap={String(state.wrap.value)}
        role="region"
        aria-label="Read-Only Source"
        tabindex={0}
        style={`--glassbox-diff-gutter: ${Math.max(4, String(start + excerpt.length).length + 1)}ch`}
      >
        <div class="text-diff__lines">
          <div class="text-diff__side">{definition.side === 'before' ? 'Before · Read Only' : 'After · Read Only'}</div>
          {excerpt.map((text, offset) => {
            const number = start + offset + 1;
            const line: DiffLine = {
              kind: 'context',
              before_line: definition.side === 'before' ? number : null,
              after_line: definition.side === 'after' ? number : null,
              text,
              ends_with_newline: terminated || number < lines.length,
            };
            return <DiffCell line={line} side={definition.side} path={path} definition={definition} />;
          })}
        </div>
      </div>
    );
  }
  const layout = effectiveLayout(state);
  const lastLine = hunks.reduce(
    (largest, hunk) =>
      Math.max(largest, hunk.before_start + hunk.before_count - 1, hunk.after_start + hunk.after_count - 1),
    0,
  );
  const gutter = Math.max(4, String(Math.max(lastLine, context?.total ?? 0)).length + 1);
  const blocks: DiffBlock[] =
    context === undefined
      ? hunks.map((hunk) => ({ kind: 'hunk', hunk, header: true }))
      : diffBlocks(hunks, context.total, context.expansion);
  return (
    <div
      class="text-diff"
      style={`--glassbox-diff-gutter: ${gutter}ch`}
      data-layout={layout}
      data-wrap={String(state.wrap.value)}
      role="region"
      aria-label="Text Diff"
      tabindex={0}
    >
      <div class="text-diff__lines">
        {layout === 'split' ? (
          <>
            <div class="text-diff__side">Before</div>
            <div class="text-diff__side">After</div>
          </>
        ) : null}
        {blocks.map((block) => {
          if (block.kind === 'expand') {
            const { expansion } = context ?? {};
            return (
              <ContextExpander
                id={context?.id ?? ''}
                gap={block.gap}
                hidden={block.hidden}
                pending={expansion?.pending === block.gap.index}
                error={expansion?.error?.gap === block.gap.index ? expansion.error.message : null}
              />
            );
          }
          const lines = block.kind === 'hunk' ? block.hunk.lines : block.lines;
          return (
            <>
              {block.kind === 'hunk' && block.header ? (
                <div class="text-diff__range">{`@@ -${range(block.hunk.before_start, block.hunk.before_count)} +${range(block.hunk.after_start, block.hunk.after_count)} @@`}</div>
              ) : null}
              {layout === 'split'
                ? splitLines(lines).map(({ before, after }) => (
                    <>
                      <DiffCell
                        line={before}
                        side="before"
                        path={path}
                        lineControl={lineControl}
                        symbols={symbols}
                        definition={definition}
                        find={find}
                      />
                      <DiffCell
                        line={after}
                        side="after"
                        path={path}
                        lineControl={lineControl}
                        symbols={symbols}
                        definition={definition}
                        find={find}
                      />
                      {rowContent?.(before?.before_line, after?.after_line)}
                    </>
                  ))
                : lines.map((line) => (
                    <>
                      <DiffCell
                        line={line}
                        side="both"
                        path={path}
                        lineControl={lineControl}
                        symbols={symbols}
                        definition={definition}
                        find={find}
                      />
                      {rowContent?.(line.before_line, line.after_line)}
                    </>
                  ))}
            </>
          );
        })}
      </div>
    </div>
  );
}

export function wireTextDiffToolbar(root: HTMLElement, id: string, state: TextDiffState) {
  const controller = new AbortController();
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('button[data-action]')?.dataset.action;
      if (action === `${id}:split`) state.layout.value = 'split';
      if (action === `${id}:inline`) state.layout.value = 'inline';
      if (action === `${id}:wrap`) state.wrap.value = !state.wrap.value;
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}

/** Routes the unchanged-line controls (`<id>:<gap>:<direction>`) to `expand` (HS2-DZ8ZR6). */
export function wireContextExpander(
  root: HTMLElement,
  id: string,
  expand: (gap: number, direction: ContextDirection) => void,
) {
  const controller = new AbortController();
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('button[data-action]')?.dataset.action;
      const [prefix, gap, direction] = action?.split(':') ?? [];
      if (prefix !== id || (direction !== 'above' && direction !== 'below' && direction !== 'all')) return;
      expand(Number(gap), direction);
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
