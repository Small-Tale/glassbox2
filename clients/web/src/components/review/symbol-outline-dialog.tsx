import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { List } from '@kerfjs/ui/list';
import { ListInsetControl } from '@kerfjs/ui/list-inset-control';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { SegmentedControl } from '@kerfjs/ui/segmented-control';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { closeDialog, DialogSurface, openDialog } from '@kerfjs/ui/surface-scaffold';
import { Text } from '@kerfjs/ui/text';
import { TextField } from '@kerfjs/ui/text-field';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { TreeList, type TreeListNode } from '@kerfjs/ui/tree-list';
import { effect } from 'kerfjs';
import { ListTree } from 'lucide';

import { toolsCollapseBelow } from '../diff/toolbar-collapse.js';
import type { Definition } from './definition-navigation.js';
import { type OutlineNode, type OutlineSide, outlineSides, outlineTree, type SymbolOutline } from './symbol-outline.js';

// HS2-E3YMJ5: a plain modal dialog, like the other review dialogs (see GB2-NV3Y0E).
/* eslint-disable kerfjs/ui-wiring */

const device = deviceClass();
const sideLabels = { before: 'Before', after: 'After' } as const;
const unsupported =
  'Symbol outlines are available for Rust, TypeScript, JavaScript and Python files in Git comparisons.';

export function SymbolOutlineAction({ id, enabled }: { id: string; enabled: boolean }) {
  const title = enabled ? 'Symbol Outline' : unsupported;
  return (
    <ToolbarControlGroup label="Symbol Outline" content="icon" hideBelow={toolsCollapseBelow}>
      <ToolbarButton
        action={`${id}:open`}
        ariaLabel="Symbol Outline"
        title={title}
        disabled={!enabled}
        icon={<LucideIcon icon={ListTree} name="list-tree" />}
      />
    </ToolbarControlGroup>
  );
}

function toTreeNode(node: OutlineNode): TreeListNode {
  return {
    id: node.id,
    label: node.symbol.name,
    description: `Line ${node.symbol.line}`,
    trailing: (
      <Badge size="compact" tone="neutral" title={node.symbol.kind} label={node.symbol.kind}>
        {node.symbol.kind}
      </Badge>
    ),
    children: node.children.length === 0 ? undefined : node.children.map(toTreeNode),
  };
}

function expandable(nodes: readonly OutlineNode[]): string[] {
  return nodes.flatMap((node) => (node.children.length === 0 ? [] : [node.id, ...expandable(node.children)]));
}

function Body({ id, state }: { id: string; state: SymbolOutline }) {
  const error = state.error.value;
  if (error !== '') return <StateBanner tone="danger" urgency="alert" title="Outline Error" detail={error} />;
  const result = state.result.value;
  if (result === null) return <EmptyState busy={state.loading.value} title="Reading the Outline" />;
  const side = sideLabels[state.side.value];
  if (result.status === 'unsupported') return <EmptyState title="Outline Unavailable" detail={unsupported} />;
  if (result.status === 'unavailable') {
    return (
      <EmptyState
        title="Nothing to Outline"
        detail={`This file has no readable source on the ${side} side, or it is too large to read.`}
      />
    );
  }
  if (result.symbols.length === 0) {
    return <EmptyState title="No Declarations" detail={`Glassbox found no declarations in the ${side} version.`} />;
  }
  const nodes = outlineTree(result.symbols, state.filter.value);
  return (
    <>
      {result.truncated ? (
        <StateBanner
          tone="info"
          title="Outline Shortened"
          detail={`Showing the first ${result.symbols.length} declarations.`}
        />
      ) : null}
      {nodes.length === 0 ? (
        <EmptyState title="No Matching Symbols" />
      ) : (
        <TreeList
          id={`${id}-symbols`}
          label="Symbols"
          nodes={nodes.map(toTreeNode)}
          expanded={expandable(nodes).filter((node) => !state.collapsed.value.has(node))}
          action="outline-symbol-select"
          toggleAction="outline-symbol-toggle"
          density="compact"
        />
      )}
    </>
  );
}

export function SymbolOutlineDialog({
  id,
  state,
  path,
  status,
  embedded = false,
}: {
  id: string;
  state: SymbolOutline;
  /** The file the outline is for; its status decides which sides can be chosen. */
  path: string;
  status: string;
  embedded?: boolean;
}) {
  const sides = outlineSides(status);
  const side: OutlineSide = sides.includes(state.side.value) ? state.side.value : (sides[0] ?? 'after');
  const result = state.result.value;
  return (
    <DialogSurface
      id={id}
      className="symbol-outline"
      label="Symbol Outline"
      presentation={embedded ? 'embedded' : device.value.compact ? 'fullscreen' : 'modal'}
      preferredWidth={px(520)}
      bodyInset="none"
      rootAttributes={{ 'data-key': id }}
      footer={
        <Button action={`${id}:close`} emphasis="secondary">
          Close
        </Button>
      }
    >
      <List gap>
        <Text tone="quiet" controlMargins="rl" wrap="anywhere">
          {sides.length > 1
            ? `Choosing a symbol shows ${path} on the ${sideLabels[side]} side.`
            : `${path} exists only on the ${sideLabels[side]} side.`}
        </Text>
        {sides.length > 1 ? (
          <ListInsetControl>
            <SegmentedControl
              id={`${id}-side`}
              label="Show Symbols From"
              action={`${id}:side`}
              choices={sides.map((value) => ({ value, label: sideLabels[value] }))}
              value={side}
              size="compact"
            />
          </ListInsetControl>
        ) : null}
        {result?.status === 'found' && result.symbols.length > 0 ? (
          <div data-key={`${id}-filter`}>
            <ListInsetControl>
              <TextField
                type="search"
                size="compact"
                ariaLabel="Filter Symbols"
                name="outline-filter"
                placeholder="Filter Symbols"
                value={state.filter.value}
              />
            </ListInsetControl>
          </div>
        ) : null}
        <Body id={id} state={state} />
      </List>
    </DialogSurface>
  );
}

type Selection = Parameters<SymbolOutline['load']>[0];

/**
 * Opens the outline for the selected file, keeps it current while open, and reveals a chosen declaration with `show`.
 * `selected` reads signals, so the outline reloads when the diff on screen changes under an open dialog.
 */
export function wireSymbolOutline(
  root: HTMLElement,
  id: string,
  state: SymbolOutline,
  selected: () => (Selection & { status: string }) | undefined,
  show: (destination: Definition) => Promise<void>,
) {
  const controller = new AbortController();
  const dialog = () => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  // Several outlines can share a page (the catalog), so rows and the filter belong to the dialog they are in.
  const inside = `#${CSS.escape(id)}`;
  const chosenSide = (status: string) => {
    const sides = outlineSides(status);
    return sides.includes(state.side.value) ? state.side.value : (sides[0] ?? 'after');
  };
  function reload() {
    const current = selected();
    if (current === undefined) return;
    state.side.value = chosenSide(current.status);
    void state.load(current, state.side.value);
  }
  const stop = effect(() => {
    const current = selected();
    if (dialog()?.open !== true || current === undefined) return;
    void state.load(current, chosenSide(current.status));
  });
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>('[data-action]');
      const action = control?.dataset.action;
      if (action === `${id}:open`) {
        const modal = dialog();
        if (modal === null) return;
        state.filter.value = '';
        reload();
        openDialog(modal);
      }
      if (action === `${id}:close`) {
        const modal = dialog();
        if (modal !== null) closeDialog(modal);
      }
      if (action === `${id}:side`) {
        const value = control?.dataset.segmentValue;
        const current = selected();
        if ((value === 'before' || value === 'after') && current !== undefined) {
          state.side.value = value;
          void state.load(current, value);
        }
      }
      const rowId = control?.dataset.itemId ?? control?.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
      if (rowId === undefined || !rowId.startsWith('symbol:') || control?.closest(inside) === null) return;
      if (action === 'outline-symbol-toggle' || action === 'outline-symbol-select') {
        const result = state.result.value;
        const symbol = result?.status === 'found' ? result.symbols[Number(rowId.slice('symbol:'.length))] : undefined;
        if (action === 'outline-symbol-toggle') {
          const collapsed = new Set(state.collapsed.value);
          if (collapsed.has(rowId)) collapsed.delete(rowId);
          else collapsed.add(rowId);
          state.collapsed.value = collapsed;
          return;
        }
        const destination = symbol === undefined ? undefined : state.destination(symbol);
        if (destination === undefined) return;
        const modal = dialog();
        if (modal !== null) closeDialog(modal);
        void show(destination);
      }
    },
    { signal: controller.signal },
  );
  root.addEventListener(
    'input',
    (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.name === 'outline-filter' &&
        event.target.closest(inside) !== null
      ) {
        state.filter.value = event.target.value;
      }
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
    stop();
  };
}
