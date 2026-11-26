import '@kerfjs/ui/select/register';

import { Button } from '@kerfjs/ui/button';
import { CheckboxGroup } from '@kerfjs/ui/checkbox-group';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { List } from '@kerfjs/ui/list';
import { ListHeader } from '@kerfjs/ui/list-header';
import { ListInsetControl } from '@kerfjs/ui/list-inset-control';
import { ListItem } from '@kerfjs/ui/list-item';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { Select } from '@kerfjs/ui/select';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { closeDialog, DialogSurface, openDialog } from '@kerfjs/ui/surface-scaffold';
import { Text } from '@kerfjs/ui/text';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { BrainCircuit, RefreshCw } from 'lucide';

import { type AnalysisSettingsState, guidanceTopics } from './analysis-settings-state.js';

// GB2-806ABB: the Kerf catalog marks `wirePinnablePopover` and `wireOverlaySheets` as required for
// the whole `surface-scaffold` entry, but this is a plain modal dialog (see GB2-NV3Y0E).
/* eslint-disable kerfjs/ui-wiring */

const device = deviceClass();

export function AnalysisSettingsAction({ id }: { id: string }) {
  return (
    <ToolbarControlGroup label="AI Settings" appearance="borderless" content="icon" single>
      <ToolbarButton
        action={`${id}:open`}
        ariaLabel="AI Settings"
        title="AI Settings"
        icon={<LucideIcon icon={BrainCircuit} name="brain-circuit" />}
      />
    </ToolbarControlGroup>
  );
}

export function AnalysisSettingsDialog({
  id,
  state,
  embedded = false,
}: {
  id: string;
  state: AnalysisSettingsState;
  embedded?: boolean;
}) {
  const view = state.view.value;
  const draft = state.draft.value;
  const pending = state.pending.value;
  const models = state.models.value ?? [];
  const approved = view?.providers.find((provider) => provider.id === draft.provider);
  const saving = pending === 'save';
  const modelChoices = models.includes(draft.model ?? '') || draft.model === null ? models : [draft.model, ...models];
  const unavailable = draft.provider !== null && approved === undefined;
  return (
    <DialogSurface
      id={id}
      className="analysis-settings"
      label="AI Settings"
      presentation={embedded ? 'embedded' : device.value.compact ? 'fullscreen' : 'modal'}
      preferredWidth={px(560)}
      bodyInset="none"
      rootAttributes={{ 'data-key': id, 'data-analysis-settings': id }}
      footer={
        <>
          <Button action={`${id}:cancel`} emphasis="secondary" disabled={saving}>
            Cancel
          </Button>
          <Button action={`${id}:save`} loading={saving} disabled={pending !== null || view === null || unavailable}>
            Save
          </Button>
        </>
      }
    >
      <List gap>
        {state.error.value === '' ? null : (
          <StateBanner tone="danger" urgency="alert" title="AI Settings Error" detail={state.error.value} />
        )}
        {pending === 'settings' ? <EmptyState busy title="Loading AI Settings" /> : null}
        {view === null ? null : (
          <>
            <ListInsetControl>
              <Select
                name="analysis-provider"
                label="Provider"
                value={draft.provider ?? ''}
                disabled={saving}
                choices={[
                  { value: '', label: 'Disabled' },
                  ...view.providers.map(({ id, name }) => ({ value: id, label: name })),
                  ...(unavailable
                    ? [{ value: draft.provider ?? '', label: 'Unavailable Provider', disabled: true }]
                    : []),
                ]}
              />
            </ListInsetControl>
            {view.providers.length === 0 ? (
              <Text tone="quiet" controlMargins="rl">
                No provider has been approved by the host.
              </Text>
            ) : null}
            {approved === undefined ? null : (
              <>
                <ListHeader label="Provider Data Destination" />
                <Text controlMargins="rl">
                  Glassbox sends text diffs to this executable only when you start an analysis. The provider controls
                  where the data is processed.
                </Text>
                <Text font="monospace" wrap="anywhere" controlMargins="rl">
                  {approved.executable}
                </Text>
                <ListInsetControl>
                  <Select
                    name="analysis-model"
                    label="Model"
                    value={draft.model ?? ''}
                    disabled={saving || pending === 'models'}
                    choices={[
                      { value: '', label: 'Provider Default' },
                      ...modelChoices.map((model) => ({ value: model, label: model })),
                    ]}
                  />
                </ListInsetControl>
                <ListItem
                  action={`${id}:models`}
                  icon={<LucideIcon icon={RefreshCw} name="refresh-cw" />}
                  label="Load Models"
                  busy={pending === 'models'}
                  disabled={pending !== null}
                />
                {state.models.value?.length === 0 ? (
                  <Text tone="quiet" controlMargins="rl">
                    The provider reported no available models.
                  </Text>
                ) : null}
              </>
            )}
            <ListInsetControl>
              <CheckboxGroup
                name="analysis-topic"
                label="Code Guidance Topics"
                choices={guidanceTopics.map(({ label, value }) => ({ label, value }))}
                value={draft.guidance_topics}
                disabled={saving}
              />
            </ListInsetControl>
          </>
        )}
      </List>
    </DialogSurface>
  );
}

export function wireAnalysisSettingsDialog(root: HTMLElement, id: string, state: AnalysisSettingsState) {
  const controller = new AbortController();
  const { signal } = controller;
  const dialog = () => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const modal = dialog();
      if (modal === null) return;
      if (action === `${id}:open`) {
        void state.refresh();
        openDialog(modal);
      }
      if (action === `${id}:cancel`) closeDialog(modal);
      if (action === `${id}:models`) void state.loadModels();
      if (action === `${id}:save`) {
        void state.save().then((saved) => {
          if (saved) closeDialog(modal);
        });
      }
    },
    { signal },
  );
  root.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target.closest<HTMLElement>('[data-analysis-settings]')?.dataset.analysisSettings !== id
      )
        return;
      if (target instanceof HTMLInputElement && target.name === 'analysis-topic') {
        state.chooseTopic(target.value, target.checked);
      }
      if (target.tagName !== 'KUI-SELECT' || !('value' in target) || typeof target.value !== 'string') return;
      const value = target.value || null;
      if (target.getAttribute('name') === 'analysis-provider') state.chooseProvider(value);
      if (target.getAttribute('name') === 'analysis-model') state.chooseModel(value);
    },
    { signal },
  );
  root.addEventListener(
    'kui-request-close',
    (event) => {
      if (event.target === dialog() && state.pending.value === 'save') event.preventDefault();
    },
    { signal },
  );
  return () => {
    controller.abort();
  };
}
