import './storage-dialog.css';

import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { closeDialog, openDialog, WorkbenchDialog } from '@kerfjs/ui/workbench-dialog';
import { HardDrive } from 'lucide';

import { formatBytes, type StorageState } from './storage-state.js';

const device = deviceClass();

export function StorageAction({ id }: { id: string }) {
  return (
    <ToolbarControlGroup label="Feedback Storage" appearance="borderless" content="icon" single>
      <ToolbarButton
        action={`${id}:open`}
        ariaLabel="Feedback Storage"
        title="Feedback Storage"
        icon={<LucideIcon icon={HardDrive} name="hard-drive" />}
      />
    </ToolbarControlGroup>
  );
}

function count(number: number) {
  return `${number} ${number === 1 ? 'bundle' : 'bundles'}`;
}

function projectName(project: string) {
  return project.split(/[\\/]/u).filter(Boolean).at(-1) ?? project;
}

export function StorageDialog({
  id,
  state,
  embedded = false,
}: {
  id: string;
  state: StorageState;
  embedded?: boolean;
}) {
  const usage = state.usage.value;
  const scope = state.scope.value;
  const report = state.report.value;
  const deleting = state.deleting.value;
  const confirming = scope !== null;
  return (
    <WorkbenchDialog
      id={id}
      label="Feedback Storage"
      title="Feedback Storage"
      embedded={embedded}
      compact={!embedded && device.value.compact}
      preferredWidth={px(580)}
      height={px(620)}
      main={
        <div class="feedback-storage">
          {scope === null ? (
            <>
              <section aria-labelledby={`${id}-usage`}>
                <h3 id={`${id}-usage`}>Saved Feedback</h3>
                {usage === null ? (
                  <p>{state.loading.value ? 'Loading storage…' : 'Storage usage is unavailable.'}</p>
                ) : (
                  <>
                    <p>
                      <strong>{formatBytes(usage.bytes)}</strong> · {count(usage.bundles)}
                    </p>
                    <p>Bundles stay on disk until you clear them.</p>
                  </>
                )}
              </section>
              {usage !== null && usage.projects.length > 0 ? (
                <section aria-labelledby={`${id}-projects`}>
                  <h3 id={`${id}-projects`}>By Project</h3>
                  <ul>
                    {usage.projects.map(({ project, bytes, bundles }) => (
                      <li>
                        <div>
                          <strong>{project === null ? 'Unassigned' : projectName(project)}</strong>
                          {project === null ? null : <small>{project}</small>}
                          <small>
                            {formatBytes(bytes)} · {count(bundles)}
                          </small>
                        </div>
                        {project === null ? null : (
                          <Button
                            action={`${id}:project`}
                            rootAttributes={{ 'data-storage-project': project }}
                            disabled={state.loading.value}
                            emphasis="plain"
                            tone="danger"
                          >
                            Clear Project
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <section aria-labelledby={`${id}-confirm`}>
              <h3 id={`${id}-confirm`}>
                {scope.kind === 'all' ? 'Clear All Saved Feedback?' : 'Clear Saved Project Feedback?'}
              </h3>
              {scope.kind === 'project' ? (
                <>
                  <strong>{projectName(scope.project)}</strong>
                  <small>{scope.project}</small>
                </>
              ) : null}
              <p>Copied AI instructions for deleted bundles will stop working. Bundles open in Glassbox are kept.</p>
            </section>
          )}
          {state.error.value === '' ? null : <p role="alert">{state.error.value}</p>}
          {report === null || confirming ? null : (
            <section aria-label="Cleanup Result">
              <p role="status">
                Removed {count(report.removed_bundles)} and reclaimed {formatBytes(report.reclaimed_bytes)}.
              </p>
              {report.active_bundles > 0 ? <p>Kept {count(report.active_bundles)} open in Glassbox.</p> : null}
              {report.problems.length > 0 ? (
                <>
                  <p role="alert">Some bundles could not be cleared. Run cleanup again to retry.</p>
                  <ul>
                    {report.problems.map(({ bundle, message }) => (
                      <li>
                        {bundle} · {message}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          )}
        </div>
      }
      mainBottomToolbar={{
        label: 'Storage Actions',
        leading: (
          <Button action={`${id}:${confirming ? 'cancel' : 'close'}`} emphasis="secondary" disabled={deleting}>
            {confirming ? 'Cancel' : 'Close'}
          </Button>
        ),
        trailing: confirming ? (
          <Button action={`${id}:delete`} tone="danger" loading={deleting} disabled={deleting}>
            Clear Saved Feedback
          </Button>
        ) : (
          <>
            <Button action={`${id}:refresh`} emphasis="plain" disabled={state.loading.value}>
              Refresh
            </Button>
            <Button
              action={`${id}:all`}
              tone="danger"
              emphasis="plain"
              disabled={state.loading.value || usage === null || usage.bundles === 0}
            >
              Clear All
            </Button>
          </>
        ),
      }}
    />
  );
}

export function wireStorageDialog(root: HTMLElement, id: string, state: StorageState) {
  const controller = new AbortController();
  const { signal } = controller;
  const dialog = () => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('button[data-action]');
      const action = button?.dataset.action;
      if (action === `${id}:open`) {
        const modal = dialog();
        if (modal === null) return;
        state.confirm(null);
        void state.refresh();
        openDialog(modal);
      }
      if (action === `${id}:close`) {
        const modal = dialog();
        if (modal !== null && !state.deleting.value) closeDialog(modal);
      }
      if (action === `${id}:refresh`) void state.refresh();
      if (action === `${id}:all`) state.confirm({ kind: 'all' });
      if (action === `${id}:project`) {
        const project = button?.dataset.storageProject;
        if (project !== undefined) state.confirm({ kind: 'project', project });
      }
      if (action === `${id}:cancel`) state.confirm(null);
      if (action === `${id}:delete`) void state.clear();
    },
    { signal },
  );
  root.addEventListener(
    'kui-request-close',
    (event) => {
      if (event.target === dialog() && state.deleting.value) event.preventDefault();
    },
    { signal },
  );
  return () => {
    controller.abort();
  };
}
