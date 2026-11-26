import './context-expander.css';

import { Button } from '@kerfjs/ui/button';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { Row } from '@kerfjs/ui/row';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { ChevronsDown, ChevronsUp, UnfoldVertical } from 'lucide';

import { contextLimit, contextStep, type Gap } from './context-expansion.js';

const lines = (count: number) => `${count} Unchanged ${count === 1 ? 'Line' : 'Lines'}`;

/** HS2-DZ8ZR6: controls that reveal the unchanged lines hidden between hunks and toward the file's ends. */
export function ContextExpander({
  id,
  gap,
  hidden,
  pending,
  error,
}: {
  id: string;
  gap: Gap;
  hidden: number;
  pending: boolean;
  error: string | null;
}) {
  const step = Math.min(contextStep, hidden);
  return (
    <div class="context-expander" data-gap={gap.index}>
      <Row wrap controlInsets="trbl">
        {hidden <= contextStep ? (
          <Button
            action={`${id}:${gap.index}:all`}
            size="compact"
            emphasis="plain"
            disabled={pending}
            loading={pending}
            title={`Show ${lines(hidden)}`}
            icon={<LucideIcon icon={UnfoldVertical} name="unfold-vertical" />}
          >
            {`Show ${hidden} ${hidden === 1 ? 'Line' : 'Lines'}`}
          </Button>
        ) : (
          <>
            {gap.hasAbove ? (
              <Button
                action={`${id}:${gap.index}:above`}
                size="compact"
                emphasis="plain"
                disabled={pending}
                title={`Show ${lines(step)} Above the Next Change`}
                icon={<LucideIcon icon={ChevronsUp} name="chevrons-up" />}
              >
                {`Show ${step} Above`}
              </Button>
            ) : null}
            {gap.hasBelow ? (
              <Button
                action={`${id}:${gap.index}:below`}
                size="compact"
                emphasis="plain"
                disabled={pending}
                title={`Show ${lines(step)} Below the Previous Change`}
                icon={<LucideIcon icon={ChevronsDown} name="chevrons-down" />}
              >
                {`Show ${step} Below`}
              </Button>
            ) : null}
            {hidden <= contextLimit ? (
              <Button
                action={`${id}:${gap.index}:all`}
                size="compact"
                emphasis="plain"
                disabled={pending}
                title={`Show All ${lines(hidden)}`}
                icon={<LucideIcon icon={UnfoldVertical} name="unfold-vertical" />}
              >
                {`Show All ${hidden}`}
              </Button>
            ) : null}
          </>
        )}
      </Row>
      {error === null ? null : (
        <StateBanner tone="danger" urgency="alert" title="Could Not Show Lines" detail={error} />
      )}
    </div>
  );
}
