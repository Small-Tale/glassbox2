import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportState, ticketReference } from '../src/components/handoff/export-state.ts';

const source = { kind: 'difftool' };
const preview = {
  destination: { name: 'Example', path: '/example.hs2' },
  feedback: { threads: 0, replies: 0, attachments: 0, paths: [], entries: [] },
  recent: [],
  message: null,
};

test('parses native ticket slugs and pasted references', () => {
  assert.equal(ticketReference('hs2-abcd1'), 'HS2-ABCD1');
  assert.equal(ticketReference('https://local/tickets/HS2-ABCD1'), 'HS2-ABCD1');
  assert.equal(ticketReference('/tickets/01M7RTKDD9QCPMETWWY82C6DWK.md'), '01M7RTKDD9QCPMETWWY82C6DWK');
  assert.equal(ticketReference('ask for a follow-up'), undefined);
});

test('New Ticket defaults and an attempted delivery retries the frozen destination and payload', async () => {
  const requests = [];
  const state = createExportState(
    () => Promise.resolve(preview),
    (payload) => {
      requests.push(payload);
      return requests.length === 1
        ? Promise.reject(new Error('Retry after a partial send.'))
        : Promise.resolve({ ticket: 'HS2-ABCD1', batch_id: 'batch' });
    },
  );
  await state.open(source, () => Promise.resolve(true));
  assert.equal(state.mode.value, 'new');
  state.summary.value = 'Original summary';
  await state.submit();
  assert.equal(state.attempted.value, true);
  assert.match(state.message.value, /partial send/u);
  state.summary.value = 'Changed summary';
  await state.submit();
  assert.equal(requests[0], requests[1]);
  assert.equal(requests[0].request.summary, 'Original summary');
  assert.deepEqual(requests[0].request.target, { kind: 'new' });
  assert.equal(state.receipt.value.ticket, 'HS2-ABCD1');
  await state.open(source, () => Promise.resolve(true));
  assert.equal(state.receipt.value, null);
  assert.equal(state.summary.value, '');
});

test('selection counts whole threads and keeps the same projection on retry', async () => {
  const entries = [
    { id: 1, revision: 3, path: 'a.ts', excerpt: 'Keep', replies: 2, attachments: 1 },
    { id: 2, revision: 1, path: 'b.ts', excerpt: 'Skip', replies: 1, attachments: 4 },
  ];
  const feedback = { entries, threads: 2, replies: 3, attachments: 5, paths: ['a.ts', 'b.ts'] };
  const requests = [];
  const state = createExportState(
    async () => ({ ...preview, feedback }),
    async (request) => {
      requests.push(request);
      if (requests.length === 1) throw new Error('Interrupted');
      return { ticket: 'HS2-ABCD1', batch_id: 'batch' };
    },
  );
  await state.open(source, async () => true);
  assert.equal(state.included.value, null);
  state.toggleSelection();
  state.setIncluded(2, false);
  assert.deepEqual(state.includedFeedback(), {
    entries: [entries[0]],
    threads: 1,
    replies: 2,
    attachments: 1,
    paths: ['a.ts'],
  });
  state.setIncluded(1, false);
  assert.equal(state.canSend(), false);
  await state.submit();
  assert.equal(requests.length, 0);
  state.setIncluded(1, true);
  await state.submit();
  state.setIncluded(2, true);
  await state.submit();
  assert.equal(requests[0], requests[1]);
  assert.deepEqual(requests[0].selection, [{ id: 1, revision: 3 }]);
  await state.open(source, async () => true);
  assert.equal(state.included.value, null);
  assert.deepEqual(state.includedFeedback(), feedback);
});

// GB2-8JB784: only a failed send is an alert; a missing project and an unsaved comment have their own places, and
// a disabled Create Ticket says why.
test('GB2-8JB784 opening never reports a failed send, and a missing project names itself', async () => {
  const missing = { ...preview, destination: null, message: 'No Hot Sheet 2 store found for this project' };
  const state = createExportState(() => Promise.resolve(missing));
  await state.open(source, () => Promise.resolve(true));
  assert.equal(state.message.value, '', 'nothing was sent, so nothing failed to send');
  assert.equal(state.projectMessage.value, 'No Hot Sheet 2 store found for this project');
  assert.equal(state.canSend(), false);
  assert.equal(state.blockedReason(), 'Choose a Hot Sheet project first.');

  const broken = createExportState(() => Promise.reject(new Error('Cannot read the store.')));
  await broken.open(source, () => Promise.resolve(true));
  assert.equal(broken.message.value, '');
  assert.equal(broken.projectMessage.value, 'Cannot read the store.');

  // Choosing a project clears the project message.
  const fixed = createExportState((_source, path) => Promise.resolve(path === null ? missing : preview));
  await fixed.open(source, () => Promise.resolve(true));
  fixed.destinationDraft.value = '/example.hs2';
  await fixed.chooseDestination();
  assert.equal(fixed.projectMessage.value, '');
  assert.equal(fixed.blockedReason(), null);
  assert.equal(fixed.canSend(), true);
});

test('GB2-8JB784 an unsaved comment is a notice, not a failed send, and reopening clears it', async () => {
  const state = createExportState(() => Promise.resolve(preview));
  await state.open(source, () => Promise.resolve(false));
  assert.equal(state.notice.value, 'Save the current comment before sending this review.');
  assert.equal(state.message.value, '');
  await state.open(source, () => Promise.resolve(true));
  assert.equal(state.notice.value, '');
});

test('GB2-8JB784 a failed delivery is the only thing that sets the alert message', async () => {
  const state = createExportState(
    () => Promise.resolve(preview),
    () => Promise.reject(new Error('Hot Sheet refused it.')),
  );
  await state.open(source, () => Promise.resolve(true));
  assert.equal(state.message.value, '');
  await state.submit();
  assert.equal(state.message.value, 'Hot Sheet refused it.');
  assert.equal(state.projectMessage.value, '');
  await state.revise();
  assert.equal(state.message.value, '', 'changing the delivery clears the failure');
});

test('GB2-8JB784 the blocked reason follows what is missing and goes quiet when sending or sent', async () => {
  const entries = [{ id: 1, revision: 1, path: 'a.ts', excerpt: 'Keep', replies: 0, attachments: 0 }];
  const feedback = { entries, threads: 1, replies: 0, attachments: 0, paths: ['a.ts'] };
  const state = createExportState(
    () => Promise.resolve({ ...preview, feedback }),
    () => Promise.resolve({ ticket: 'HS2-ABCD1', batch_id: 'batch' }),
  );
  assert.equal(state.blockedReason(), 'Choose a Hot Sheet project first.');
  await state.open(source, () => Promise.resolve(true));
  assert.equal(state.blockedReason(), null);

  state.changingDestination.value = true;
  assert.match(state.blockedReason(), /Finish choosing the project/u);
  state.changingDestination.value = false;

  state.mode.value = 'existing';
  assert.equal(state.blockedReason(), 'Enter a ticket ID or paste a reference.');
  state.reference.value = 'HS2-ABCD1';
  assert.equal(state.blockedReason(), null);

  state.mode.value = 'new';
  state.toggleSelection();
  state.setIncluded(1, false);
  assert.equal(state.blockedReason(), 'Select at least one thread to send.');
  state.setIncluded(1, true);
  assert.equal(state.blockedReason(), null);

  state.loading.value = true;
  assert.equal(state.blockedReason(), null, 'nothing is said while the project loads');
  state.loading.value = false;
  await state.submit();
  assert.notEqual(state.receipt.value, null);
  assert.equal(state.blockedReason(), null, 'nothing is said after it was sent');
});
