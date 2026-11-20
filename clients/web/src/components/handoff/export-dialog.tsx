import '@kerfjs/ui/popup-menu/register';
import './export-dialog.css';

import { Button } from '@kerfjs/ui/button';
import { Checkbox } from '@kerfjs/ui/checkbox';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { PopupMenu } from '@kerfjs/ui/popup-menu';
import { SegmentedControl } from '@kerfjs/ui/segmented-control';
import { TextField } from '@kerfjs/ui/text-field';
import { closeDialog, openDialog, WorkbenchDialog } from '@kerfjs/ui/workbench-dialog';

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
    <WorkbenchDialog
      id={id}
      label={heading}
      title={heading}
      embedded={embedded}
      compact={!embedded && device.value.compact}
      preferredWidth={px(672)}
      height={px(760)}
      main={
        <div class="feedback-export" data-export-form={id}>
          <section class="feedback-export__section" aria-labelledby={`${id}-project`}>
            <h3 id={`${id}-project`}>Hot Sheet Project</h3>
            <div class="feedback-export__group">
              <div class="feedback-export__row">
                <div>
                  <strong>
                    {destination?.name ?? (state.loading.value ? 'Finding Project…' : 'Choose a Project')}
                  </strong>
                  {destination === null ? null : <small>{destination.path}</small>}
                </div>
                <Button action="export-change" tone="brand" emphasis="plain" disabled={locked || state.loading.value}>
                  Change
                </Button>
              </div>
              {changing ? (
                <div class="feedback-export__row">
                  <TextField
                    name="export-destination"
                    label="Project or Store Path"
                    value={state.destinationDraft.value}
                  />
                  <Button
                    action="export-project"
                    tone="brand"
                    disabled={state.destinationDraft.value.trim() === '' || state.loading.value}
                  >
                    Use Project
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          <section class="feedback-export__section" aria-labelledby={`${id}-ticket`}>
            <h3 id={`${id}-ticket`}>Ticket</h3>
            <div class="feedback-export__group">
              <div class="feedback-export__row">
                <span>Send as</span>
                <SegmentedControl
                  id={`${id}-type`}
                  label="Send As"
                  action="export-mode"
                  choices={choices}
                  value={state.mode.value}
                  size="compact"
                  disabled={locked}
                />
              </div>
              {existing ? (
                <div class="feedback-export__row">
                  <TextField
                    name="export-reference"
                    label="Ticket"
                    placeholder="Enter a ticket ID or paste a reference"
                    value={state.reference.value}
                    readOnly={locked}
                  />
                  <PopupMenu
                    label="Recent"
                    triggerContent={<span class="feedback-export__recent">Recent</span>}
                    emphasis="plain"
                    caret={false}
                    placement="bottom-end"
                    disabled={locked || destination === null || state.loading.value}
                    items={[
                      { kind: 'heading', label: 'Recent Tickets' },
                      ...state.recent.value.map((ticket) => ({
                        label: ticket.title,
                        value: ticket.slug,
                        details: (
                          <span>
                            {ticket.slug} · {ticket.status.replaceAll('_', ' ')}
                          </span>
                        ),
                      })),
                      ...(state.recent.value.length === 0 ? [{ label: 'No Recent Tickets', disabled: true }] : []),
                    ]}
                    rootAttributes={{ 'data-export-recent': id }}
                  />
                </div>
              ) : (
                <TextField
                  name="export-title"
                  label="Title"
                  placeholder="Glassbox review feedback"
                  value={state.title.value}
                  readOnly={locked}
                />
              )}
            </div>
          </section>

          <section class="feedback-export__section" aria-labelledby={`${id}-review`}>
            <h3 id={`${id}-review`}>Review</h3>
            <div class="feedback-export__group">
              <TextField
                name="export-summary"
                label="Summary"
                placeholder="Optional overall notes (Markdown)"
                multiline
                rows={3}
                value={state.summary.value}
                readOnly={locked}
              />
            </div>
          </section>

          <section class="feedback-export__section" aria-labelledby={`${id}-included`}>
            <h3 id={`${id}-included`}>Included Feedback</h3>
            <div class="feedback-export__group">
              <div class="feedback-export__row">
                {feedback.threads === 0 ? (
                  <span>{included === null ? 'No feedback has been recorded.' : 'No threads selected.'}</span>
                ) : (
                  <span>
                    {feedback.threads} {feedback.threads === 1 ? 'thread' : 'threads'} · {files}
                  </span>
                )}
                {available.threads === 0 ? null : (
                  <Button
                    action="export-selection"
                    tone="brand"
                    emphasis="plain"
                    disabled={locked || state.loading.value}
                  >
                    {included === null ? 'Select Threads' : 'Include Everything'}
                  </Button>
                )}
              </div>
              {feedback.replies > 0 ? (
                <span>
                  {feedback.replies} {feedback.replies === 1 ? 'reply' : 'replies'}
                </span>
              ) : null}
              {feedback.attachments > 0 ? (
                <span>
                  {feedback.attachments} {feedback.attachments === 1 ? 'attachment' : 'attachments'}
                </span>
              ) : null}
              {included === null
                ? null
                : available.paths.map((path) => (
                    <fieldset class="feedback-export__selection">
                      <legend>{path}</legend>
                      {available.entries
                        .filter((thread) => thread.path === path)
                        .map((thread) => (
                          <Checkbox
                            label={thread.excerpt}
                            name="export-thread"
                            value={String(thread.id)}
                            checked={included.some(({ id }) => id === thread.id)}
                            disabled={locked || state.loading.value}
                          />
                        ))}
                    </fieldset>
                  ))}
            </div>
          </section>
        </div>
      }
      mainFooter={
        state.message.value !== '' ? (
          <p class="feedback-export__notice" role="alert">
            {state.message.value}
          </p>
        ) : receipt === null ? undefined : (
          <p class="feedback-export__notice" role="status">
            Feedback sent to {receipt.ticket}.
          </p>
        )
      }
      mainBottomToolbar={{
        label: 'Delivery Actions',
        responsive: 'wrap',
        leading: (
          <Button action="export-close" emphasis="secondary" disabled={state.sending.value}>
            {receipt === null ? 'Cancel' : 'Done'}
          </Button>
        ),
        trailing:
          receipt !== null ? undefined : (
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
          ),
      }}
    />
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
      const button = event.target.closest<HTMLElement>('button[data-action]');
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
