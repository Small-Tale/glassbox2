import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportState, ticketReference } from '../src/components/handoff/export-state.ts';

const source = { kind: 'difftool' };
const preview = {
  destination: { name: 'Example', path: '/example.hs2' },
  feedback: { threads: 0, replies: 0, attachments: 0, paths: [] },
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
