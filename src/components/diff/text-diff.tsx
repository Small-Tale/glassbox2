import './text-diff.css';

import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { signal } from 'kerfjs';
import { Columns2, Rows2, WrapText } from 'lucide';

import { type DiffLine, splitLines, syntaxTokens, type TextHunk } from './text-diff-model.js';

export function createTextDiffState() {
  return {
    layout: signal<'split' | 'inline'>('split'),
    wrap: signal(true),
  };
}

type TextDiffState = ReturnType<typeof createTextDiffState>;

export function TextDiffToolbar({ id, state }: { id: string; state: TextDiffState }) {
  return (
    <>
      <ToolbarControlGroup label="Diff Layout" content="icon">
        <ToolbarButton
          action={`${id}:split`}
          pressed={state.layout.value === 'split'}
          ariaLabel="Side by Side"
          title="Side by Side"
          icon={<LucideIcon icon={Columns2} name="columns-2" />}
        />
        <ToolbarButton
          action={`${id}:inline`}
          pressed={state.layout.value === 'inline'}
          ariaLabel="Inline"
          title="Inline"
          icon={<LucideIcon icon={Rows2} name="rows-2" />}
        />
      </ToolbarControlGroup>
      <ToolbarControlGroup label="Line Wrapping" content="icon">
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

function DiffCell({ line, side, path }: { line?: DiffLine; side: 'before' | 'after' | 'both'; path: string }) {
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
    >
      {side === 'after' ? null : (
        <span class="text-diff__number" aria-label={before === null ? undefined : `Before line ${before}`}>
          {before}
        </span>
      )}
      {side === 'before' ? null : (
        <span class="text-diff__number" aria-label={after === null ? undefined : `After line ${after}`}>
          {after}
        </span>
      )}
      <span class="text-diff__marker">{mark}</span>
      <code>
        {syntaxTokens(line.text, path).map((token) => (
          <span data-token={token.kind}>{token.text}</span>
        ))}
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

export function TextDiff({ hunks, path, state }: { hunks: readonly TextHunk[]; path: string; state: TextDiffState }) {
  const layout = state.layout.value;
  const lastLine = hunks.reduce(
    (largest, hunk) =>
      Math.max(largest, hunk.before_start + hunk.before_count - 1, hunk.after_start + hunk.after_count - 1),
    0,
  );
  const gutter = Math.max(4, String(lastLine).length + 1);
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
        {hunks.map((hunk) => (
          <>
            <div class="text-diff__range">{`@@ -${range(hunk.before_start, hunk.before_count)} +${range(hunk.after_start, hunk.after_count)} @@`}</div>
            {layout === 'split'
              ? splitLines(hunk.lines).map(({ before, after }) => (
                  <>
                    <DiffCell line={before} side="before" path={path} />
                    <DiffCell line={after} side="after" path={path} />
                  </>
                ))
              : hunk.lines.map((line) => <DiffCell line={line} side="both" path={path} />)}
          </>
        ))}
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
