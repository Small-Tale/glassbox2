import { signal } from 'kerfjs';

import type { ReviewSource } from '../review/review-source.js';

export type SavedReview = { id: string; updated_at: number };
export type SavedView = { reviews: SavedReview[]; active: boolean; paths: string[] };

async function request(source: ReviewSource, id?: string): Promise<SavedView> {
  const response = await fetch('/api/v1/review/saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, id }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as SavedView;
}

// HS2-42A696: delete one saved review. The host re-checks ownership and refuses an open review.
async function removeReview(source: ReviewSource, id: string): Promise<SavedView> {
  const response = await fetch('/api/v1/review/saved/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, id, confirmed: true }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as SavedView;
}

export function createSavedReviewState(load = request, remove = removeReview) {
  const view = signal<SavedView | null>(null);
  const pending = signal(false);
  const error = signal('');
  const confirming = signal<SavedReview | null>(null);
  const deleting = signal(false);
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
  function confirmDelete(review: SavedReview | null) {
    if (!deleting.value && !pending.value) {
      confirming.value = review;
      error.value = '';
    }
  }
  async function deleteConfirmed(source: ReviewSource) {
    const target = confirming.value;
    if (target === null || deleting.value || pending.value) return false;
    deleting.value = true;
    error.value = '';
    try {
      const result = await remove(source, target.id);
      view.value = result;
      confirming.value = null;
      return true;
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
      return false;
    } finally {
      deleting.value = false;
    }
  }
  return { view, error, pending, confirming, deleting, update, confirmDelete, deleteConfirmed };
}
