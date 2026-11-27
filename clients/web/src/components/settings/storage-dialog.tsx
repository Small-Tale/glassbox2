import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { Disclosure } from '@kerfjs/ui/disclosure';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { List } from '@kerfjs/ui/list';
import { ListHeader } from '@kerfjs/ui/list-header';
import { ListInsetText } from '@kerfjs/ui/list-inset-text';
import { ListItem } from '@kerfjs/ui/list-item';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { closeDialog, DialogSurface, openDialog } from '@kerfjs/ui/surface-scaffold';
import { Text } from '@kerfjs/ui/text';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { HardDrive, Trash2 } from 'lucide';

import { copyText } from './copy-text.js';
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
  const loading = state.loading.value;
  const error = state.error.value;
  const confirming = scope !== null;
  return (
    <DialogSurface
      id={id}
      className="feedback-storage"
      label="Feedback Storage"
      presentation={embedded ? 'embedded' : device.value.compact ? 'fullscreen' : 'modal'}
      preferredWidth={px(580)}
      bodyInset="none"
      rootAttributes={{ 'data-key': id }}
      footer={
        confirming ? (
          <>
            <Button action={`${id}:cancel`} emphasis="secondary" disabled={deleting}>
              Cancel
            </Button>
            <Button action={`${id}:delete`} tone="danger" loading={deleting} disabled={deleting}>
              Clear Saved Feedback
            </Button>
          </>
        ) : (
          <>
            <Button action={`${id}:refresh`} emphasis="plain" disabled={loading}>
              Refresh
            </Button>
            <Button
              action={`${id}:all`}
              tone="danger"
              emphasis="plain"
              disabled={loading || usage === null || usage.bundles === 0}
            >
              Clear All
            </Button>
            <Button action={`${id}:close`} emphasis="secondary" disabled={deleting}>
              Close
            </Button>
          </>
        )
      }
    >
      <List gap>
        {error === '' ? null : (
          <StateBanner tone="danger" urgency="alert" title="Feedback Storage Error" detail={error} />
        )}
        {scope !== null ? (
          <>
            <ListHeader label={scope.kind === 'all' ? 'Clear All Saved Feedback?' : 'Clear Saved Project Feedback?'} />
            {scope.kind === 'project' ? (
              <ListInsetText>
                <Text weight="strong" wrap="anywhere" flush>
                  {projectName(scope.project)}
                </Text>
                <Text tone="quiet" size="compact" wrap="anywhere" flush>
                  {scope.project}
                </Text>
              </ListInsetText>
            ) : null}
            <Text controlMargins="rl">
              Copied AI instructions for deleted bundles will stop working. Bundles open in Glassbox are kept.
            </Text>
          </>
        ) : (
          <>
            <ListHeader label="Saved Feedback" />
            {usage === null ? (
              <EmptyState
                busy={loading}
                title={loading ? 'Loading Storage' : 'Storage Unavailable'}
                detail={loading ? undefined : 'Storage usage could not be read.'}
              />
            ) : (
              <>
                <Text
                  weight="strong"
                  controlMargins="rl"
                >{`${formatBytes(usage.bytes)} · ${count(usage.bundles)}`}</Text>
                <Text tone="quiet" controlMargins="rl">
                  Bundles stay on disk until you clear them.
                </Text>
              </>
            )}
            {usage !== null && usage.projects.length > 0 ? (
              <>
                <ListHeader label="By Project" />
                {usage.projects.map(({ project, bytes, bundles }) =>
                  project === null ? (
                    <ListInsetText>
                      <Text weight="strong" flush>
                        Unassigned
                      </Text>
                      <Text tone="quiet" size="compact" flush>
                        {`${formatBytes(bytes)} · ${count(bundles)}`}
                      </Text>
                    </ListInsetText>
                  ) : (
                    <ListItem
                      action={`${id}:project`}
                      icon={<LucideIcon icon={Trash2} name="trash-2" />}
                      label={projectName(project)}
                      status={`${formatBytes(bytes)} · ${count(bundles)}`}
                      accessibleLabel={`Clear ${projectName(project)}`}
                      disabled={loading}
                      multiline
                      rootAttributes={{ 'data-storage-project': project }}
                    />
                  ),
                )}
                <Disclosure title="Project locations" size="compact" appearance="plain">
                  {usage.projects.map(({ project }) =>
                    project === null ? null : (
                      <>
                        <Text weight="strong" size="compact" wrap="anywhere" controlMargins="rl">
                          {projectName(project)}
                        </Text>
                        <Text size="compact" font="monospace" wrap="anywhere" controlMargins="rl">
                          {project}
                        </Text>
                        <Button
                          action={`${id}:copy`}
                          emphasis="plain"
                          size="compact"
                          ariaLabel={`Copy Path of ${projectName(project)}`}
                          rootAttributes={{ 'data-copy-value': project }}
                        >
                          Copy Path
                        </Button>
                      </>
                    ),
                  )}
                  {state.copied.value === '' ? null : (
                    <Text role="status" tone="quiet" size="compact" controlMargins="rl">
                      {state.copied.value}
                    </Text>
                  )}
                </Disclosure>
              </>
            ) : null}
          </>
        )}
        {report === null || confirming ? null : (
          <>
            <StateBanner
              tone="success"
              title={`Removed ${count(report.removed_bundles)}`}
              detail={`Reclaimed ${formatBytes(report.reclaimed_bytes)}.`}
            />
            {report.active_bundles > 0 ? (
              <StateBanner
                tone="info"
                title="Open Bundles Kept"
                detail={`Kept ${count(report.active_bundles)} open in Glassbox.`}
              />
            ) : null}
            {report.problems.length > 0 ? (
              <>
                <StateBanner
                  tone="warning"
                  urgency="alert"
                  title="Some Bundles Could Not Be Cleared"
                  detail="Run cleanup again to retry."
                />
                {report.problems.map(({ bundle, message }) => (
                  <ListInsetText>
                    <Text size="compact" wrap="anywhere" flush>{`${bundle} · ${message}`}</Text>
                  </ListInsetText>
                ))}
              </>
            ) : null}
          </>
        )}
      </List>
    </DialogSurface>
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
      const button = event.target.closest<HTMLElement>('[data-action]');
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
        const project = event.target.closest<HTMLElement>('[data-storage-project]')?.dataset.storageProject;
        if (project !== undefined) state.confirm({ kind: 'project', project });
      }
      if (action === `${id}:copy`) {
        const value = event.target.closest<HTMLElement>('[data-copy-value]')?.dataset.copyValue;
        if (value !== undefined) void copyText(value).then((message) => (state.copied.value = message));
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
