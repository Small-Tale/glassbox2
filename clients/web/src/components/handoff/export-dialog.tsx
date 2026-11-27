import '@kerfjs/ui/popup-menu/register';

import { Button } from '@kerfjs/ui/button';
import { CheckboxGroup } from '@kerfjs/ui/checkbox-group';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { List } from '@kerfjs/ui/list';
import { ListHeader } from '@kerfjs/ui/list-header';
import { ListInsetControl } from '@kerfjs/ui/list-inset-control';
import { ListInsetText } from '@kerfjs/ui/list-inset-text';
import { ListItem } from '@kerfjs/ui/list-item';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { PopupMenu } from '@kerfjs/ui/popup-menu';
import { SegmentedControl } from '@kerfjs/ui/segmented-control';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { closeDialog, DialogSurface, openDialog } from '@kerfjs/ui/surface-scaffold';
import { Text } from '@kerfjs/ui/text';
import { TextField } from '@kerfjs/ui/text-field';
import { FolderOpen, ListChecks } from 'lucide';

import type { ReviewSource } from '../review/review-source.js';
import type { ExportMode, ExportState } from './export-state.js';

const choices = [
  { value: 'new', label: 'New Ticket' },
  { value: 'existing', label: 'Add to Existing Ticket' },
] satisfies readonly { value: ExportMode; label: string }[];

const heading = 'Send to Hot Sheet 2';
const device = deviceClass();

export function ExportDialog({ id, state, embedded = false }: { id: string; state: ExportState; embedded?: boolean }) {
  const destination = state.destination.value;
  const changing = state.changingDestination.value;
  const locked = state.attempted.value;
  const existing = state.mode.value === 'existing';
  const feedback = state.includedFeedback();
  const included = state.included.value;
  const available = state.feedback.value;
  const receipt = state.receipt.value;
  const files = feedback.paths.length === 1 ? feedback.paths[0] : `${feedback.paths.length} files`;
  const submitLabel = locked ? 'Retry' : existing ? 'Add to Ticket' : 'Create Ticket';
  return (
    <DialogSurface
      id={id}
      className="feedback-export"
      label={heading}
      presentation={embedded ? 'embedded' : device.value.compact ? 'fullscreen' : 'modal'}
      preferredWidth={px(672)}
      bodyInset="none"
      rootAttributes={{ 'data-key': id, 'data-export-form': id }}
      footer={
        <>
          <Button action="export-close" emphasis="secondary" disabled={state.sending.value}>
            {receipt === null ? 'Cancel' : 'Done'}
          </Button>
          {receipt !== null ? null : (
            <>
              {locked && !state.sending.value ? (
                <Button action="export-revise" emphasis="plain" tone="brand">
                  Change Delivery
                </Button>
              ) : null}
              <Button action="export-submit" tone="brand" loading={state.sending.value} disabled={!state.canSend()}>
                {submitLabel}
              </Button>
            </>
          )}
        </>
      }
    >
      <List gap>
        {state.message.value !== '' ? (
          <StateBanner tone="danger" urgency="alert" title="Could Not Send Feedback" detail={state.message.value} />
        ) : receipt === null ? null : (
          <StateBanner tone="success" title={`Feedback sent to ${receipt.ticket}.`} />
        )}
        {state.notice.value === '' ? null : (
          <StateBanner tone="warning" title="Not Ready to Send" detail={state.notice.value} />
        )}

        <ListHeader label="Hot Sheet Project" />
        <ListInsetText>
          <Text weight="strong" wrap="anywhere" flush>
            {destination?.name ?? (state.loading.value ? 'Finding Project…' : 'None chosen')}
          </Text>
          {destination === null ? (
            state.loading.value ? null : (
              <Text tone="quiet" size="compact" wrap="anywhere" flush>
                {state.projectMessage.value === ''
                  ? 'Use Change Project to choose a Hot Sheet 2 project.'
                  : `${state.projectMessage.value.replace(/[.!?]?$/u, '.')} Use Change Project to choose one.`}
              </Text>
            )
          ) : (
            <>
              <Text tone="quiet" size="compact" wrap="anywhere" flush>
                {destination.path}
              </Text>
              {state.projectMessage.value === '' ? null : (
                <Text tone="quiet" size="compact" wrap="anywhere" flush>
                  {state.projectMessage.value}
                </Text>
              )}
            </>
          )}
        </ListInsetText>
        <ListItem
          action="export-change"
          icon={<LucideIcon icon={FolderOpen} name="folder-open" />}
          label="Change Project"
          disabled={locked || state.loading.value}
        />
        {changing ? (
          <>
            <ListInsetControl>
              <TextField name="export-destination" label="Project or Store Path" value={state.destinationDraft.value} />
            </ListInsetControl>
            <ListInsetControl sides="rbl">
              <Button
                action="export-project"
                tone="brand"
                disabled={state.destinationDraft.value.trim() === '' || state.loading.value}
              >
                Use Project
              </Button>
            </ListInsetControl>
          </>
        ) : null}

        <ListHeader label="Ticket" />
        <ListInsetControl>
          <SegmentedControl
            id={`${id}-type`}
            label="Send As"
            action="export-mode"
            choices={choices}
            value={state.mode.value}
            size="compact"
            disabled={locked}
          />
        </ListInsetControl>
        {existing ? (
          <ListInsetControl>
            <TextField
              name="export-reference"
              label="Ticket"
              placeholder="Enter a ticket ID or paste a reference"
              value={state.reference.value}
              readOnly={locked}
            />
            <PopupMenu
              label="Recent"
              emphasis="plain"
              caret={false}
              placement="bottom-end"
              disabled={locked || destination === null || state.loading.value}
              items={[
                { kind: 'heading', label: 'Recent Tickets' },
                ...state.recent.value.map((ticket) => ({
                  label: ticket.title,
                  value: ticket.slug,
                  details: <>{`${ticket.slug} · ${ticket.status.replaceAll('_', ' ')}`}</>,
                })),
                ...(state.recent.value.length === 0 ? [{ label: 'No Recent Tickets', disabled: true }] : []),
              ]}
              rootAttributes={{ 'data-export-recent': id }}
            />
          </ListInsetControl>
        ) : (
          <ListInsetControl>
            <TextField
              name="export-title"
              label="Title"
              placeholder="Glassbox review feedback"
              value={state.title.value}
              readOnly={locked}
            />
          </ListInsetControl>
        )}

        <ListHeader label="Review" />
        <ListInsetControl>
          <TextField
            name="export-summary"
            label="Summary"
            placeholder="Optional overall notes (Markdown)"
            multiline
            rows={3}
            value={state.summary.value}
            readOnly={locked}
          />
        </ListInsetControl>

        <ListHeader label="Included Feedback" />
        <Text controlMargins="rl">
          {feedback.threads === 0
            ? included === null
              ? 'No feedback has been recorded yet. Add a comment on a line in the diff to include it.'
              : 'No threads selected.'
            : `${feedback.threads} ${feedback.threads === 1 ? 'thread' : 'threads'} · ${files}`}
        </Text>
        {feedback.replies > 0 ? (
          <Text tone="quiet" controlMargins="rl">
            {`${feedback.replies} ${feedback.replies === 1 ? 'reply' : 'replies'}`}
          </Text>
        ) : null}
        {feedback.attachments > 0 ? (
          <Text tone="quiet" controlMargins="rl">
            {`${feedback.attachments} ${feedback.attachments === 1 ? 'attachment' : 'attachments'}`}
          </Text>
        ) : null}
        {available.threads === 0 ? null : (
          <ListItem
            action="export-selection"
            icon={<LucideIcon icon={ListChecks} name="list-checks" />}
            label={included === null ? 'Select Threads' : 'Include Everything'}
            disabled={locked || state.loading.value}
          />
        )}
        {included === null
          ? null
          : available.paths.map((path) => (
              <ListInsetControl>
                <CheckboxGroup
                  name="export-thread"
                  label={path}
                  choices={available.entries
                    .filter((thread) => thread.path === path)
                    .map((thread) => ({ label: thread.excerpt, value: String(thread.id) }))}
                  value={included.map(({ id }) => String(id))}
                  disabled={locked || state.loading.value}
                />
              </ListInsetControl>
            ))}
        {state.blockedReason() === null ? null : (
          <Text role="status" tone="quiet" controlMargins="rl">
            {state.blockedReason()}
          </Text>
        )}
      </List>
    </DialogSurface>
  );
}

export function wireExportDialog(root: HTMLElement, id: string, state: ExportState) {
  const controller = new AbortController();
  const { signal } = controller;
  const dialog = () => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  const belongs = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement && target.closest('dialog')?.id === id;

  root.addEventListener(
    'change',
    (event) => {
      const field = event.target;
      if (!belongs(field) || !(field instanceof HTMLInputElement) || field.name !== 'export-thread') return;
      state.setIncluded(Number(field.value), field.checked);
    },
    { signal },
  );
  root.addEventListener(
    'input',
    (event) => {
      const field = event.target;
      if (!belongs(field) || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
      if (field.name === 'export-destination') state.destinationDraft.value = field.value;
      if (field.name === 'export-title') state.title.value = field.value;
      if (field.name === 'export-reference') state.reference.value = field.value;
      if (field.name === 'export-summary') state.summary.value = field.value;
    },
    { signal },
  );
  root.addEventListener(
    'kui-menu-select',
    (event) => {
      const menu = event.target;
      if (!(menu instanceof HTMLElement) || menu.dataset.exportRecent !== id || !(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (typeof detail === 'object' && detail !== null && 'value' in detail && typeof detail.value === 'string') {
        state.reference.value = detail.value;
      }
    },
    { signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-action]');
      if (!belongs(button)) return;
      const action = button.dataset.action;
      if (action === undefined) return;
      switch (action) {
        case 'export-close': {
          const modal = dialog();
          if (modal !== null && !state.sending.value) closeDialog(modal);
          break;
        }
        case 'export-mode': {
          const value = button.dataset.segmentValue;
          if (value === 'new' || value === 'existing') state.mode.value = value;
          break;
        }
        case 'export-change':
          state.changingDestination.value = !state.changingDestination.value;
          break;
        case 'export-project':
          void state.chooseDestination();
          break;
        case 'export-submit':
          void state.submit();
          break;
        case 'export-revise':
          void state.revise();
          break;
        case 'export-selection':
          state.toggleSelection();
          break;
      }
    },
    { signal },
  );
  root.addEventListener(
    'kui-request-close',
    (event) => {
      if (event.target === dialog() && state.sending.value) event.preventDefault();
    },
    { signal },
  );
  root.addEventListener(
    'close',
    (event) => {
      if (event.target === dialog()) state.close();
    },
    { signal, capture: true },
  );

  return {
    open: (source: ReviewSource, flush: () => Promise<boolean>) => {
      const modal = dialog();
      if (modal === null || modal.open) return;
      void state.open(source, flush);
      openDialog(modal);
    },
    stop: () => {
      controller.abort();
    },
  };
}
