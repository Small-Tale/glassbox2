import '@kerfjs/ui/popup-menu/register';

import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { List } from '@kerfjs/ui/list';
import { ListActionRow } from '@kerfjs/ui/list-action-row';
import { ListHeader } from '@kerfjs/ui/list-header';
import { ListItem } from '@kerfjs/ui/list-item';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { closeDialog, DialogSurface, openDialog } from '@kerfjs/ui/surface-scaffold';
import { Text } from '@kerfjs/ui/text';
import { Ellipsis, FileText, History, Trash2 } from 'lucide';

import type { ReviewSource } from '../review/review-source.js';
import { createSavedReviewState, type SavedReview } from './saved-review-state.js';

export { createSavedReviewState };

// GB2-FRH9JJ: the Kerf catalog marks `wirePinnablePopover` and `wireOverlaySheets` as required for
// the whole `surface-scaffold` entry, but these are plain modal dialogs with no pinned popover or
// bottom sheet to wire. The gap is recorded in docs/ui-conventions.md for the Kerf maintainers.
/* eslint-disable kerfjs/ui-wiring */

const device = deviceClass();

type SavedReviewState = ReturnType<typeof createSavedReviewState>;

function savedAt(review: SavedReview) {
  return new Date(review.updated_at * 1000).toLocaleString();
}

// HS2-42A696 and GB2-FRH9JJ: a single-pane DialogSurface (header, body, footer) whose body is a
// List of Kerf rows, so the dialog owns every inset and the app adds no CSS of its own.
export function SavedReviewDialog({
  id,
  state,
  changedPaths,
  embedded = false,
}: {
  id: string;
  state: SavedReviewState;
  changedPaths: ReadonlySet<string>;
  embedded?: boolean;
}) {
  const view = state.view.value;
  const stale = view?.paths.filter((path) => !changedPaths.has(path)) ?? [];
  const pending = state.pending.value;
  const error = state.error.value;
  const confirming = state.confirming.value;
  const deleting = state.deleting.value;
  return (
    <>
      <DialogSurface
        id={id}
        className="saved-review-dialog"
        label="Saved Reviews"
        presentation={embedded ? 'embedded' : device.value.compact ? 'fullscreen' : 'modal'}
        preferredWidth={px(500)}
        bodyInset="none"
        rootAttributes={{ 'data-key': id }}
        footer={
          <Button action={`${id}:close`} emphasis="secondary">
            Close
          </Button>
        }
      >
        <List gap>
          {error === '' || confirming !== null ? null : (
            <StateBanner tone="danger" urgency="alert" title="Saved Reviews Unavailable" detail={error} />
          )}
          {pending && view === null ? <EmptyState busy title="Loading Saved Reviews" /> : null}
          {view?.active === true ? (
            <EmptyState title="Review Open" detail="This comparison has an open review." />
          ) : view !== null && view.reviews.length === 0 ? (
            <EmptyState title="No Saved Reviews" detail="No editable reviews were saved for this comparison." />
          ) : null}
          {view?.active === false
            ? view.reviews.map((review) => (
                <ListActionRow
                  action={`${id}:restore:${review.id}`}
                  itemId={review.id}
                  icon={<LucideIcon icon={History} name="history" />}
                  label={savedAt(review)}
                  description={review.id}
                  disabled={pending}
                  trailingMenu={{
                    label: `Actions for ${review.id}`,
                    icon: <LucideIcon icon={Ellipsis} name="ellipsis" />,
                    disabled: pending,
                    items: [
                      {
                        label: 'Delete…',
                        action: `${id}:ask-delete:${review.id}`,
                        icon: <LucideIcon icon={Trash2} name="trash-2" />,
                        tone: 'danger',
                      },
                    ],
                  }}
                />
              ))
            : null}
          {stale.length === 0 ? null : (
            <>
              <ListHeader label="Discussions Outside the Changed Files" />
              {stale.map((path, index) => (
                <ListItem
                  action={`${id}:path:${index}`}
                  icon={<LucideIcon icon={FileText} name="file-text" />}
                  label={path}
                  disabled={pending}
                />
              ))}
            </>
          )}
        </List>
      </DialogSurface>
      {embedded ? null : (
        <DialogSurface
          id={`${id}-delete`}
          alert
          label="Delete Saved Review?"
          size="small"
          describedBy={`${id}-delete-detail`}
          bodyInset="none"
          rootAttributes={{ 'data-key': `${id}-delete` }}
          footer={
            <>
              <Button rootAttributes={{ 'data-dialog-close': '' }} emphasis="secondary" disabled={deleting}>
                Cancel
              </Button>
              <Button action={`${id}:delete`} tone="danger" loading={deleting} disabled={deleting}>
                Delete Review
              </Button>
            </>
          }
        >
          <List>
            {error === '' || confirming === null ? null : (
              <StateBanner tone="danger" urgency="alert" title="Could Not Delete the Review" detail={error} />
            )}
            {confirming === null ? null : (
              <Text weight="strong" controlMargins="trbl">{`${savedAt(confirming)} · ${confirming.id}`}</Text>
            )}
            <Text id={`${id}-delete-detail`} controlMargins="trbl">
              Copied AI instructions for this review will stop working. Other saved reviews and open reviews are kept.
            </Text>
          </List>
        </DialogSurface>
      )}
    </>
  );
}

export function wireSavedReviewDialog(
  root: HTMLElement,
  id: string,
  state: SavedReviewState,
  getSource: () => ReviewSource | null,
  getPaths: () => ReadonlySet<string>,
  onRestore: () => void,
  onOpenPath: (source: ReviewSource, path: string) => Promise<boolean>,
) {
  const controller = new AbortController();
  const dialog = (dialogId = id) => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(dialogId)}`);
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const modal = dialog();
      const source = getSource();
      if (action === undefined || modal === null || source === null) return;
      if (action === `${id}:close`) closeDialog(modal);
      if (action.startsWith(`${id}:ask-delete:`)) {
        const review = state.view.value?.reviews.find((item) => item.id === action.slice(`${id}:ask-delete:`.length));
        const confirmation = dialog(`${id}-delete`);
        if (review !== undefined && confirmation !== null) {
          state.confirmDelete(review);
          openDialog(confirmation);
        }
      }
      if (action === `${id}:delete`) {
        void state.deleteConfirmed(source).then((deleted) => {
          const confirmation = dialog(`${id}-delete`);
          if (deleted && confirmation !== null) closeDialog(confirmation);
        });
      }
      if (action.startsWith(`${id}:restore:`)) {
        void state.update(source, action.slice(`${id}:restore:`.length)).then((opened) => {
          if (opened && getSource() === source) onRestore();
        });
      }
      if (action.startsWith(`${id}:path:`)) {
        const index = Number(action.slice(`${id}:path:`.length));
        const paths = state.view.value?.paths.filter((path) => !getPaths().has(path));
        const path = paths?.[index];
        if (path !== undefined) {
          void onOpenPath(source, path).then((opened) => {
            if (opened) closeDialog(modal);
          });
        }
      }
    },
    { signal: controller.signal },
  );
  // The confirmation is a native dialog: whichever way it closes, the choice is cleared with it.
  root.addEventListener(
    'close',
    (event) => {
      if (event.target === dialog(`${id}-delete`)) state.confirmDelete(null);
    },
    { capture: true, signal: controller.signal },
  );
  root.addEventListener(
    'kui-request-close',
    (event) => {
      if (state.deleting.value && (event.target === dialog() || event.target === dialog(`${id}-delete`))) {
        event.preventDefault();
      }
    },
    { signal: controller.signal },
  );
  const open = () => {
    const modal = dialog();
    const source = getSource();
    if (modal === null || source === null) return;
    state.confirmDelete(null);
    void state.update(source);
    openDialog(modal);
  };
  return {
    open,
    dispose: () => {
      controller.abort();
    },
  };
}
