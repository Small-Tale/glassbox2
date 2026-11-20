import { signal } from 'kerfjs';

import type { ReviewSource } from '../review/review-source.js';

async function prepare(source: ReviewSource): Promise<string> {
  const response = await fetch('/api/v1/review/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as string;
}

async function writeInstruction(value: Promise<string>) {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    const item = new ClipboardItem({
      'text/plain': value.then((text) => new Blob([text], { type: 'text/plain' })),
    });
    await navigator.clipboard.write([item]);
  } else {
    await navigator.clipboard.writeText(await value);
  }
}

export function createHandoffState(load = prepare, copy = writeInstruction) {
  const pending = signal(false);
  const status = signal('');

  async function copyInstruction(source: ReviewSource, save: () => Promise<boolean>) {
    if (pending.value) return;
    pending.value = true;
    status.value = '';
    try {
      const instruction = save().then((saved) => {
        if (!saved) throw new Error('Save your current comment before copying the instruction.');
        return load(source);
      });
      await Promise.all([instruction, copy(instruction)]);
      status.value = 'AI instruction copied.';
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : '';
      status.value =
        detail === '' ? 'Could not copy the AI instruction.' : `Could not copy the AI instruction. ${detail}`;
    } finally {
      pending.value = false;
    }
  }

  return { pending, status, copyInstruction };
}

export type HandoffState = ReturnType<typeof createHandoffState>;
