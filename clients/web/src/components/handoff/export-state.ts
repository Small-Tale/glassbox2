import { signal } from 'kerfjs';

import type { ReviewSource } from '../review/review-source.js';

export type ExportMode = 'new' | 'existing';
export type RecentTicket = { slug: string; title: string; status: string };
export type Destination = { name: string; path: string };
export type FeedbackPreview = { threads: number; replies: number; attachments: number; paths: string[] };
export type ExportPreview = {
  destination: Destination | null;
  recent: RecentTicket[];
  feedback: FeedbackPreview;
  message: string | null;
};
type Receipt = { ticket: string; batch_id: string };
type Send = {
  id: string;
  source: ReviewSource;
  destination: string;
  request: {
    target: { kind: 'new' } | { kind: 'existing'; reference: string };
    title: string;
    summary: string | null;
  };
};

async function post<T>(endpoint: string, body: object): Promise<T> {
  const response = await fetch(`/api/v1/review/export/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

function preview(source: ReviewSource, destination: string | null) {
  return post<ExportPreview>('preview', { source, destination, recent: true });
}

function send(delivery: Send) {
  return post<Receipt>('send', delivery);
}

export function ticketReference(value: string): string | undefined {
  const tokens = value
    .trim()
    .split(/[^a-z\d-]+/iu)
    .filter(Boolean);
  const isSlug = (token: string) => /^[a-z][a-z\d]{0,15}-[a-z\d]{4,16}$/iu.test(token);
  const ulid = tokens.find((token) => /^[0-9a-hjkmnp-tv-z]{26}$/iu.test(token));
  if (ulid !== undefined) return ulid.toUpperCase();
  const slugs = tokens.filter(isSlug);
  const found = tokens.length === 1 ? slugs[0] : slugs.find((slug) => slug === slug.toUpperCase() || /\d/u.test(slug));
  return found?.toUpperCase();
}

export function createExportState(load = preview, deliver = send) {
  const mode = signal<ExportMode>('new');
  const destination = signal<Destination | null>(null);
  const destinationDraft = signal('');
  const changingDestination = signal(false);
  const recent = signal<RecentTicket[]>([]);
  const feedback = signal<FeedbackPreview>({ threads: 0, replies: 0, attachments: 0, paths: [] });
  const title = signal('');
  const reference = signal('');
  const summary = signal('');
  const loading = signal(false);
  const sending = signal(false);
  const attempted = signal(false);
  const message = signal('');
  const receipt = signal<Receipt | null>(null);
  let source: ReviewSource | null = null;
  let generation = 0;
  let queued: Send | null = null;

  function close() {
    generation++;
    source = null;
    loading.value = false;
  }

  async function update(path: string | null) {
    if (source === null) return;
    const request = ++generation;
    loading.value = true;
    message.value = '';
    try {
      const result = await load(source, path);
      if (request !== generation) return;
      if (result.destination !== null) {
        destination.value = result.destination;
        changingDestination.value = false;
      }
      recent.value = result.recent;
      feedback.value = result.feedback;
      message.value = result.message ?? '';
    } catch (error) {
      if (request === generation)
        message.value = error instanceof Error ? error.message : 'Could not load the project.';
    } finally {
      if (request === generation) loading.value = false;
    }
  }

  async function open(active: ReviewSource, flush: () => Promise<boolean>) {
    close();
    source = active;
    const request = generation;
    destination.value = null;
    destinationDraft.value = '';
    changingDestination.value = false;
    recent.value = [];
    feedback.value = { threads: 0, replies: 0, attachments: 0, paths: [] };
    mode.value = 'new';
    title.value = '';
    reference.value = '';
    summary.value = '';
    resetDelivery();
    if (await flush()) {
      if (request === generation) await update(null);
    } else if (request === generation) {
      message.value = 'Save the current comment before sending this review.';
    }
  }

  function resetDelivery() {
    queued = null;
    attempted.value = false;
    receipt.value = null;
    message.value = '';
  }

  async function chooseDestination() {
    const path = destinationDraft.value.trim();
    if (path === '') return;
    const previous = destination.value?.path;
    await update(path);
    if (destination.value?.path !== previous) reference.value = '';
  }

  function canSend() {
    return (
      destination.value !== null &&
      !loading.value &&
      !changingDestination.value &&
      !sending.value &&
      receipt.value === null &&
      (mode.value === 'new' || ticketReference(reference.value) !== undefined)
    );
  }

  async function submit() {
    if (source === null || destination.value === null || !canSend()) return;
    const selected = ticketReference(reference.value);
    const target =
      mode.value === 'existing' && selected !== undefined
        ? { kind: 'existing' as const, reference: selected }
        : { kind: 'new' as const };
    queued ??= {
      id: crypto.randomUUID(),
      source,
      destination: destination.value.path,
      request: {
        target,
        title: title.value.trim(),
        summary: summary.value.trim() || null,
      },
    };
    attempted.value = true;
    sending.value = true;
    message.value = '';
    try {
      receipt.value = await deliver(queued);
    } catch (error) {
      message.value =
        error instanceof Error ? error.message : 'Delivery failed. Use Retry to continue the same delivery.';
    } finally {
      sending.value = false;
    }
  }

  return {
    mode,
    destination,
    destinationDraft,
    changingDestination,
    recent,
    feedback,
    title,
    reference,
    summary,
    loading,
    sending,
    attempted,
    message,
    receipt,
    open,
    close,
    chooseDestination,
    resetDelivery,
    canSend,
    submit,
  };
}

export type ExportState = ReturnType<typeof createExportState>;
