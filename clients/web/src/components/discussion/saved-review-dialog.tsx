import './saved-review-dialog.css';

import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { closeDialog, openDialog, WorkbenchDialog } from '@kerfjs/ui/workbench-dialog';

import type { ReviewSource } from '../review/review-source.js';
import { createSavedReviewState } from './saved-review-state.js';

export { createSavedReviewState };

const device = deviceClass();

type SavedReviewState = ReturnType<typeof createSavedReviewState>;

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
    <WorkbenchDialog
      id={id}
      label="Saved Reviews"
      title="Saved Reviews"
      embedded={embedded}
      compact={!embedded && device.value.compact}
      preferredWidth={px(500)}
      height={px(420)}
      main={
        <section class="saved-review-dialog" aria-label="Saved Feedback">
          {pending ? <p role="status">Loading saved feedback…</p> : null}
          {error === '' ? null : <p role="alert">{error}</p>}
          {confirming !== null ? (
            <section aria-labelledby={`${id}-confirm`}>
              <h3 id={`${id}-confirm`}>Delete Saved Review?</h3>
              <p>{new Date(confirming.updated_at * 1000).toLocaleString() + ' · ' + confirming.id}</p>
              <p>
                Copied AI instructions for this review will stop working. Other saved reviews and open reviews are kept.
              </p>
            </section>
          ) : view?.active === true ? (
            <p>This comparison has an open review.</p>
          ) : view !== null && view.reviews.length === 0 ? (
            <p>No editable reviews were saved for this comparison.</p>
          ) : null}
          {confirming === null && view?.active === false && view.reviews.length > 0 ? (
            <ul>
              {view.reviews.map((review) => (
                <li>
                  <Button action={`${id}:restore:${review.id}`} disabled={pending} emphasis="plain">
                    {new Date(review.updated_at * 1000).toLocaleString() + ' · ' + review.id}
                  </Button>
                  <Button
                    action={`${id}:ask-delete:${review.id}`}
                    ariaLabel={`Delete Saved Review ${review.id}`}
                    disabled={pending}
                    emphasis="plain"
                    tone="danger"
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {confirming !== null || stale.length === 0 ? null : (
            <>
              <h3>Discussions Outside the Changed Files</h3>
              <ul>
                {stale.map((path, index) => (
                  <li>
                    <Button action={`${id}:path:${index}`} disabled={pending} emphasis="plain">
                      {path}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      }
      mainBottomToolbar={{
        label: 'Saved Review Actions',
        leading:
          confirming === null ? undefined : (
            <Button action={`${id}:cancel-delete`} emphasis="secondary" disabled={deleting}>
              Cancel
            </Button>
          ),
        trailing:
          confirming === null ? (
            <Button action={`${id}:close`}>Close</Button>
          ) : (
            <Button action={`${id}:delete`} tone="danger" loading={deleting} disabled={deleting}>
              Delete Review
            </Button>
          ),
      }}
    />
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
  const dialog = () => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
      const modal = dialog();
      const source = getSource();
      if (action === undefined || modal === null || source === null) return;
      if (action === `${id}:close`) closeDialog(modal);
      if (action.startsWith(`${id}:ask-delete:`)) {
        const review = state.view.value?.reviews.find((item) => item.id === action.slice(`${id}:ask-delete:`.length));
        if (review !== undefined) state.confirmDelete(review);
      }
      if (action === `${id}:cancel-delete`) state.confirmDelete(null);
      if (action === `${id}:delete`) void state.deleteConfirmed(source);
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
  const open = () => {
    const modal = dialog();
    const source = getSource();
    if (modal === null || source === null) return;
    state.confirmDelete(null);
    void state.update(source);
    openDialog(modal);
  };
  root.addEventListener(
    'kui-request-close',
    (event) => {
      if (event.target === dialog() && state.deleting.value) event.preventDefault();
    },
    { signal: controller.signal },
  );
  return {
    open,
    dispose: () => {
      controller.abort();
    },
  };
}
