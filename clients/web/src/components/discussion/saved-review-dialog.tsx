import './saved-review-dialog.css';

import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { closeDialog, openDialog, WorkbenchDialog } from '@kerfjs/ui/workbench-dialog';
import { signal } from 'kerfjs';

import type { ReviewSource } from '../review/review-source.js';

type SavedReview = { id: string; updated_at: number };
type SavedView = { reviews: SavedReview[]; active: boolean; paths: string[] };
const device = deviceClass();

async function request(source: ReviewSource, id?: string): Promise<SavedView> {
  const response = await fetch('/api/v1/review/saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, id }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as SavedView;
}

export function createSavedReviewState(load = request) {
  const view = signal<SavedView | null>(null);
  const pending = signal(false);
  const error = signal('');
  let sequence = 0;
  async function update(source: ReviewSource, id?: string) {
    const current = ++sequence;
    pending.value = true;
    error.value = '';
    if (id === undefined) view.value = null;
    try {
      const result = await load(source, id);
      if (sequence !== current) return false;
      view.value = result;
      return true;
    } catch (failure) {
      if (sequence === current) error.value = failure instanceof Error ? failure.message : String(failure);
      return false;
    } finally {
      if (sequence === current) pending.value = false;
    }
  }
  return { view, error, pending, update };
}

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
          {view?.active === true ? (
            <p>This comparison has an open review.</p>
          ) : view !== null && view.reviews.length === 0 ? (
            <p>No editable reviews were saved for this comparison.</p>
          ) : null}
          {view?.active === false && view.reviews.length > 0 ? (
            <ul>
              {view.reviews.map((review) => (
                <li>
                  <Button action={`${id}:restore:${review.id}`} disabled={pending} emphasis="plain">
                    {new Date(review.updated_at * 1000).toLocaleString() + ' · ' + review.id}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {stale.length === 0 ? null : (
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
        trailing: <Button action={`${id}:close`}>Close</Button>,
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
