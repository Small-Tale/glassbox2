import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { readSearchField, SearchField } from '@kerfjs/ui/search-field';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { wireSearchFields } from '@kerfjs/ui/wire-search-fields';
import { ChevronDown, ChevronUp } from 'lucide';

import { type FindState, stepMatch } from './diff-find.js';
import { toolsCollapseBelow } from './toolbar-collapse.js';

/** HS2-30ZEFE: Find within the lines the diff shows, with a count, previous and next. */
export function DiffFindControls({
  id,
  state,
  readout,
  matches,
}: {
  id: string;
  state: FindState;
  readout: string;
  matches: number;
}) {
  const open = state.open.value;
  return (
    <>
      <ToolbarControlGroup
        single
        content="search"
        expanded={open}
        label="Find in Diff"
        sizing="grow"
        growBasis="14rem"
        // Collapsed and narrow, Find is a More Tools entry; open, its field stays where it can be typed in (GB2-8T670B).
        hideBelow={open ? undefined : toolsCollapseBelow}
      >
        <SearchField
          id={`${id}-field`}
          label="Find in Diff"
          presentation="toolbar-group"
          collapsible
          expanded={open}
          placeholder="Find in Shown Lines"
          query={state.query.value}
          revision={state.revision.value}
          resultText={readout}
          clearAction={`${id}:clear`}
        />
      </ToolbarControlGroup>
      <ToolbarControlGroup label="Find Matches" content="icon" hideBelow={toolsCollapseBelow}>
        <ToolbarButton
          action={`${id}:previous`}
          disabled={matches === 0}
          ariaLabel="Previous Match"
          title="Previous Match (Shift+Enter)"
          icon={<LucideIcon icon={ChevronUp} name="chevron-up" />}
        />
        <ToolbarButton
          action={`${id}:next`}
          disabled={matches === 0}
          ariaLabel="Next Match"
          title="Next Match (Enter)"
          icon={<LucideIcon icon={ChevronDown} name="chevron-down" />}
        />
      </ToolbarControlGroup>
    </>
  );
}

/**
 * Wires the field, the step buttons and Ctrl/Cmd+F. `count` reads the matches in the lines now shown, so stepping
 * wraps over exactly what the readout counts.
 */
export function wireDiffFind(root: HTMLElement, id: string, state: FindState, count: () => number) {
  const fieldId = `${id}-field`;
  const controller = new AbortController();
  const { signal } = controller;
  const fields = wireSearchFields(root, { collapsible: { signals: { [fieldId]: state.open } } });
  const editor = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-search-field-editor]') : null;
  // The current match scrolls into view once the diff has re-rendered with it marked.
  const reveal = () => {
    requestAnimationFrame(() => {
      root.querySelector('mark[data-find="current"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  const step = (direction: 1 | -1) => {
    state.current.value = stepMatch(count(), state.current.peek(), direction);
    reveal();
  };
  const clear = () => {
    state.query.value = '';
    state.current.value = 0;
    state.revision.value += 1;
  };
  root.addEventListener(
    'input',
    (event) => {
      const field = editor(event.target);
      if (
        field === null ||
        field.closest(`[data-component="search-field"][data-search-field-id="${fieldId}"]`) === null
      )
        return;
      state.query.value = readSearchField(field).query;
      state.current.value = 0;
      reveal();
    },
    { signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const field = editor(event.target);
      if (field !== null && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        step(event.shiftKey ? -1 : 1);
      } else if (field !== null && event.key === 'Escape' && state.query.peek() !== '') {
        event.preventDefault();
        event.stopPropagation();
        clear();
      }
    },
    { signal, capture: true },
  );
  // On the document so the shortcut works when focus is on the page body, as after a click in WebKit.
  document.addEventListener(
    'keydown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return;
      if (root.querySelector(`[data-action="${id}:next"]`) === null) return;
      event.preventDefault();
      fields.open(fieldId);
    },
    { signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('button[data-action]')?.dataset.action;
      if (action === `${id}:next`) step(1);
      else if (action === `${id}:previous`) step(-1);
      else if (action === `${id}:clear`) clear();
    },
    { signal },
  );
  return () => {
    controller.abort();
    fields.dispose();
  };
}
