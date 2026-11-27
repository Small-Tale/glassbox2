import '@kerfjs/ui/popup-menu/register';

import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { PopupMenu } from '@kerfjs/ui/popup-menu';
import { Text } from '@kerfjs/ui/text';
import { ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { Monitor, Moon, Sun, SunMoon } from 'lucide';

import { type AppearanceState, isAppearance } from './appearance-state.js';

const choices = [
  { label: 'System', value: 'system', icon: <LucideIcon icon={Monitor} name="monitor" /> },
  { label: 'Light', value: 'light', icon: <LucideIcon icon={Sun} name="sun" /> },
  { label: 'Dark', value: 'dark', icon: <LucideIcon icon={Moon} name="moon" /> },
] as const;

export function AppearanceMenu({ id, state }: { id: string; state: AppearanceState }) {
  const appearance = state.appearance.value;
  return (
    <>
      {state.status.value === '' ? null : (
        <Text variant="span" role="status">
          {state.status.value}
        </Text>
      )}
      <ToolbarControlGroup
        label="Appearance"
        className="appearance-menu"
        appearance="borderless"
        content="icon"
        single
        nestedDropdown
      >
        <PopupMenu
          label="Appearance"
          icon={<LucideIcon icon={SunMoon} name="sun-moon" />}
          caret={false}
          placement="top-end"
          items={choices.map((choice) => ({ ...choice, checked: choice.value === appearance }))}
          rootAttributes={{ 'data-appearance-menu': id }}
        />
      </ToolbarControlGroup>
    </>
  );
}

export function wireAppearanceMenu(root: HTMLElement, id: string, state: AppearanceState) {
  const controller = new AbortController();
  root.addEventListener(
    'kui-menu-select',
    (event: Event) => {
      const menu = event.target;
      if (!(menu instanceof HTMLElement) || menu.dataset.appearanceMenu !== id) return;
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail === 'object' && detail !== null && 'value' in detail && isAppearance(detail.value)) {
        void state.choose(detail.value);
      }
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
