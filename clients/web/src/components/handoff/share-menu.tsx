import '@kerfjs/ui/popup-menu/register';
import './share-menu.css';

import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { PopupMenu } from '@kerfjs/ui/popup-menu';
import { ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { Share2 } from 'lucide';

import type { ReviewSource } from '../review/review-source.js';
import type { HandoffState } from './handoff-state.js';

export function ShareMenu({
  id,
  state,
  ready,
  exportReady = false,
  savedReviews = false,
}: {
  id: string;
  state: HandoffState;
  ready: boolean;
  exportReady?: boolean;
  savedReviews?: boolean;
}) {
  return (
    <ToolbarControlGroup
      label="Share Feedback"
      className="share-menu"
      appearance="borderless"
      content="icon"
      single
      nestedDropdown
    >
      <PopupMenu
        label="Share Feedback"
        icon={<LucideIcon icon={Share2} name="share-2" />}
        caret={false}
        placement="top-end"
        disabled={!ready || state.pending.value}
        items={[
          { label: 'Send to Hot Sheet 2…', value: 'export', disabled: !exportReady },
          { label: 'Copy AI Instruction', value: 'copy' },
          ...(savedReviews ? [{ label: 'Saved Reviews…', value: 'saved' }] : []),
        ]}
        rootAttributes={{ 'data-share-menu': id }}
      />
    </ToolbarControlGroup>
  );
}

export function ShareStatus({ state }: { state: HandoffState }) {
  const message = state.status.value;
  return message === '' ? null : (
    <span class="share-status" role="status">
      {message}
    </span>
  );
}

export function wireShareMenu(
  root: HTMLElement,
  id: string,
  state: HandoffState,
  getSource: () => ReviewSource | null,
  save: () => Promise<boolean>,
  openExport?: () => void,
  openSavedReviews?: () => void,
) {
  const controller = new AbortController();
  root.addEventListener(
    'kui-menu-select',
    (event) => {
      const menu = event.target;
      if (!(menu instanceof HTMLElement) || menu.dataset.shareMenu !== id || !(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== 'object' || detail === null || !('value' in detail)) return;
      const source = getSource();
      if (source === null) return;
      if (detail.value === 'copy') void state.copyInstruction(source, save);
      if (detail.value === 'export') openExport?.();
      if (detail.value === 'saved') openSavedReviews?.();
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
