import '@kerfjs/ui/select/register';
import './analysis-settings-dialog.css';

import { Button } from '@kerfjs/ui/button';
import { Checkbox } from '@kerfjs/ui/checkbox';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { Select } from '@kerfjs/ui/select';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { closeDialog, openDialog, WorkbenchDialog } from '@kerfjs/ui/workbench-dialog';
import { BrainCircuit } from 'lucide';

import { type AnalysisSettingsState, guidanceTopics } from './analysis-settings-state.js';

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
    <WorkbenchDialog
      id={id}
      label="AI Settings"
      title="AI Settings"
      embedded={embedded}
      compact={!embedded && device.value.compact}
      preferredWidth={px(560)}
      height={px(620)}
      main={
        <div class="analysis-settings" data-analysis-settings={id}>
          {pending === 'settings' ? <p role="status">Loading AI settings…</p> : null}
          {view === null ? null : (
            <>
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
              {view.providers.length === 0 ? <p>No provider has been approved by the host.</p> : null}
              {approved === undefined ? null : (
                <section aria-label="Provider Data Destination">
                  <p>
                    Glassbox sends text diffs to this executable only when you start an analysis. The provider controls
                    where the data is processed.
                  </p>
                  <code>{approved.executable}</code>
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
                  <Button
                    action={`${id}:models`}
                    emphasis="plain"
                    loading={pending === 'models'}
                    disabled={pending !== null}
                  >
                    Load Models
                  </Button>
                  {state.models.value?.length === 0 ? <p>The provider reported no available models.</p> : null}
                </section>
              )}
              <fieldset>
                <legend>Code Guidance Topics</legend>
                {guidanceTopics.map(({ label, value }) => (
                  <Checkbox
                    name={`analysis-topic-${value}`}
                    label={label}
                    checked={draft.guidance_topics.includes(value)}
                    disabled={saving}
                  />
                ))}
              </fieldset>
            </>
          )}
          {state.error.value === '' ? null : <p role="alert">{state.error.value}</p>}
        </div>
      }
      mainBottomToolbar={{
        label: 'AI Settings Actions',
        leading: (
          <Button action={`${id}:cancel`} emphasis="secondary" disabled={saving}>
            Cancel
          </Button>
        ),
        trailing: (
          <Button action={`${id}:save`} loading={saving} disabled={pending !== null || view === null || unavailable}>
            Save
          </Button>
        ),
      }}
    />
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
      const action = event.target.closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
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
      if (target instanceof HTMLInputElement && target.name.startsWith('analysis-topic-')) {
        state.chooseTopic(target.name.slice('analysis-topic-'.length), target.checked);
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
