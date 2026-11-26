import { Button } from '@kerfjs/ui/button';

import type { DiscussionState } from './discussion-state.js';

const reasons = {
  ambiguous: 'More than one line matches the commented text, so the comment stays with the earlier version.',
  missing: 'No line matches the commented text, so the comment stays with the earlier version.',
  hidden: 'The only match is in unchanged lines the diff does not show, so the comment stays with the earlier version.',
  unavailable: 'This comment did not record its text, so it cannot look for a new line.',
} as const;

/** HS2-RV5BD8: offers a stale line comment a new line, only when its text has one shown match, and only on confirmation. */
export function RelocationOffer({ state }: { state: Pick<DiscussionState, 'relocation' | 'pending'> }) {
  const offer = state.relocation.value;
  if (offer === null) {
    return (
      <div class="discussion-inspector__actions">
        <Button action="discussion-relocate" emphasis="plain" tone="brand" disabled={state.pending.value}>
          Suggest New Line
        </Button>
      </div>
    );
  }
  if (offer === 'asking') return <p role="status">Looking for the commented line…</p>;
  if (offer.outcome === 'current') return null;
  if (offer.outcome !== 'suggestion') {
    return (
      <>
        <p role="status">{reasons[offer.outcome]}</p>
        <div class="discussion-inspector__actions">
          <Button action="discussion-relocate-dismiss" emphasis="plain">
            Dismiss
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p role="status">{`The commented text is now at ${offer.side === 'before' ? 'Before' : 'After'} line ${offer.line}.`}</p>
      <div class="discussion-inspector__actions">
        <Button action="discussion-relocate-dismiss" emphasis="plain">
          Dismiss
        </Button>
        <Button action="discussion-relocate-confirm" tone="brand" disabled={state.pending.value}>
          Move Here
        </Button>
      </div>
    </>
  );
}
