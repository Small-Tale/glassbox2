import './analysis-controls.css';

import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { ChevronLeft, ChevronRight, Compass, ShieldAlert } from 'lucide';

import type { AnalysisState, Mode, Selection } from './analysis-state.js';

const labels = { risk: 'Risk Analysis', guidance: 'Code Guidance' } as const;
const actions = [
  { mode: 'risk', icon: ShieldAlert, name: 'shield-alert' },
  { mode: 'guidance', icon: Compass, name: 'compass' },
] as const;

export function AnalysisControls({ id, state }: { id: string; state: AnalysisState }) {
  return (
    <>
      {actions.map(({ mode, icon, name }) => (
        <ToolbarControlGroup label={labels[mode]} content="icon">
          <ToolbarButton
            action={`${id}:${mode}`}
            ariaLabel={labels[mode]}
            title={labels[mode]}
            pressed={state.modes[mode].enabled.value}
            icon={<LucideIcon icon={icon} name={name} />}
          />
        </ToolbarControlGroup>
      ))}
    </>
  );
}

function statusText(state: AnalysisState, mode: Mode): string {
  const current = state.modes[mode];
  if (!current.enabled.value) return '';
  if (current.error.value !== '') return current.error.value;
  const job = current.status.value;
  if (current.pending.value) {
    if (job?.status === 'running' && job.total > 0) return `Analyzing ${job.completed} of ${job.total}.`;
    return 'Starting analysis…';
  }
  if (job?.status === 'unavailable' || job?.status === 'failed') return job.message;
  if (job?.status === 'partial') {
    const failed = job.result.failures?.length ?? 0;
    return `Analysis unavailable for ${failed} ${failed === 1 ? 'file' : 'files'}. Showing available results.`;
  }
  if (job?.status === 'stale') return 'The comparison changed during analysis. Toggle again to retry.';
  return '';
}

function guidanceFor(state: AnalysisState, selection: Selection) {
  const model = state.modes.guidance;
  if (!model.enabled.value) return undefined;
  const status = model.status.value;
  if (status?.status !== 'complete' && status?.status !== 'partial') return undefined;
  const candidate = status.result.files.find(
    ({ path, revision }) => path === selection.path && revision === selection.revision,
  );
  return candidate?.analysis.kind === 'guidance' ? candidate.analysis : undefined;
}

export function AnalysisContext({ id, state, selection }: { id: string; state: AnalysisState; selection: Selection }) {
  const riskStatus = statusText(state, 'risk');
  const guidanceStatus = statusText(state, 'guidance');
  const guide = guidanceFor(state, selection);
  if (riskStatus === '' && guidanceStatus === '' && guide === undefined) return null;
  const index = Math.min(state.stepIndex.value, Math.max(0, (guide?.steps.length ?? 0) - 1));
  const step = guide?.steps[index];
  return (
    <div class="analysis-context">
      {riskStatus === '' ? null : (
        <p role="status">
          {labels.risk} · {riskStatus}
        </p>
      )}
      {guidanceStatus === '' ? null : (
        <p role="status">
          {labels.guidance} · {guidanceStatus}
        </p>
      )}
      {guide === undefined ? null : (
        <div class="analysis-context__guide">
          <Badge size="compact" tone="info">
            Code Guidance
          </Badge>
          <span>{step === undefined ? guide.overview : `Line ${step.line} · ${step.text}`}</span>
          {guide.steps.length <= 1 ? null : (
            <div class="analysis-context__steps" aria-label="Guidance Steps">
              <Button
                action={`${id}:previous`}
                ariaLabel="Previous Guidance Step"
                title="Previous Guidance Step"
                size="compact"
                emphasis="plain"
                disabled={index === 0}
                icon={<LucideIcon icon={ChevronLeft} name="chevron-left" />}
              />
              <span>
                {index + 1} of {guide.steps.length}
              </span>
              <Button
                action={`${id}:next`}
                ariaLabel="Next Guidance Step"
                title="Next Guidance Step"
                size="compact"
                emphasis="plain"
                disabled={index + 1 >= guide.steps.length}
                icon={<LucideIcon icon={ChevronRight} name="chevron-right" />}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function wireAnalysisControls(
  root: HTMLElement,
  id: string,
  state: AnalysisState,
  selected: () => Selection | undefined,
) {
  const controller = new AbortController();
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('button[data-action]')?.dataset.action;
      if (action === `${id}:risk`) void state.toggle('risk', selected());
      if (action === `${id}:guidance`) void state.toggle('guidance', selected());
      if (action === `${id}:next`) state.stepIndex.value++;
      if (action === `${id}:previous`) state.stepIndex.value = Math.max(0, state.stepIndex.value - 1);
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
