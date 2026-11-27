import '@kerfjs/ui/popup-menu/register';

import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { PopupMenu } from '@kerfjs/ui/popup-menu';
import { ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { Ellipsis, type IconNode } from 'lucide';

import { toolsCollapseBelow } from './toolbar-collapse.js';

export type ComparisonTool = {
  /** The `data-action` of the toolbar control this entry stands in for; choosing it activates that control. */
  action: string;
  label: string;
  icon: IconNode;
  iconName: string;
  checked?: boolean;
  disabled?: boolean;
};

/**
 * The secondary comparison tools in one menu, shown only where the toolbar is too narrow for them (GB2-8T670B).
 * Each entry activates the control it mirrors, so state and behavior have one owner.
 */
export function ComparisonToolsMenu({ id, tools }: { id: string; tools: readonly ComparisonTool[] }) {
  return (
    <ToolbarControlGroup
      label="More Tools"
      className="comparison-tools-menu"
      appearance="borderless"
      content="icon"
      single
      nestedDropdown
      showBelow={toolsCollapseBelow}
    >
      <PopupMenu
        label="More Tools"
        icon={<LucideIcon icon={Ellipsis} name="ellipsis" />}
        caret={false}
        placement="bottom-end"
        items={tools.map(({ action, label, icon, iconName, checked, disabled }) => ({
          label,
          value: action,
          checked,
          disabled,
          icon: <LucideIcon icon={icon} name={iconName} />,
        }))}
        rootAttributes={{ 'data-comparison-tools': id }}
      />
    </ToolbarControlGroup>
  );
}

/**
 * `handlers` answer entries that have no toolbar control to activate (a collapsed Find field, for example), keyed by
 * the entry's `action`.
 */
export function wireComparisonToolsMenu(root: HTMLElement, id: string, handlers: Record<string, () => void> = {}) {
  const controller = new AbortController();
  root.addEventListener(
    'kui-menu-select',
    (event: Event) => {
      const menu = event.target;
      if (!(menu instanceof HTMLElement) || menu.dataset.comparisonTools !== id) return;
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== 'object' || detail === null || !('value' in detail) || typeof detail.value !== 'string')
        return;
      const handler = handlers[detail.value];
      if (handler !== undefined) {
        handler();
        return;
      }
      // The mirrored control is hidden at this width but still in the toolbar, with the state and the handler.
      root.querySelector<HTMLElement>(`[data-action="${CSS.escape(detail.value)}"]`)?.click();
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
