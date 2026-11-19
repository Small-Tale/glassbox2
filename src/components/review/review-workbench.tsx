import './review-workbench.css';

import { ToolbarActionLink, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { ToolbarText } from '@kerfjs/ui/toolbar-text';
import { wireWorkbench } from '@kerfjs/ui/wire-workbench';
import { Workbench } from '@kerfjs/ui/workbench';
import { type SafeHtml, signal } from 'kerfjs';

export function createReviewWorkbenchState() {
  return {
    files: { collapsed: signal(false), size: signal(236), overlay: signal(false) },
    inspector: { collapsed: signal(false), size: signal(302), overlay: signal(false) },
  };
}

type ReviewWorkbenchState = ReturnType<typeof createReviewWorkbenchState>;

interface ReviewWorkbenchProps {
  id: string;
  state: ReviewWorkbenchState;
  projectTitle: string;
  comparisonTitle: string;
  inspectorTitle: string;
  navigator: SafeHtml;
  comparison: SafeHtml;
  inspector: SafeHtml;
}

export function ReviewWorkbench({
  id,
  state,
  projectTitle,
  comparisonTitle,
  inspectorTitle,
  navigator,
  comparison,
  inspector,
}: ReviewWorkbenchProps) {
  return (
    <div class="review-workbench">
      <Workbench
        id={id}
        label="Review Workbench"
        mainLabel="Comparison"
        mainMinSize={320}
        main={comparison}
        mainToolbar={{
          label: 'Comparison',
          responsive: 'wrap',
          title: <ToolbarText text={comparisonTitle} size="xlarge-fixed" headingLevel={1} />,
        }}
        mainBottomToolbar={{
          label: 'Review Actions',
          leading: (
            <ToolbarControlGroup label="Component Catalog" appearance="borderless" single content="text">
              <ToolbarActionLink href="/ux-demo/" label="Component Catalog" />
            </ToolbarControlGroup>
          ),
        }}
        leftRail={{
          label: 'Changed Files',
          size: state.files.size.value,
          collapsed: state.files.collapsed.value,
          overlaid: state.files.overlay.value,
          responsiveOverlayAt: 730,
          resizable: { min: 180, max: 420 },
          toolbar: {
            label: 'Changed Files',
            title: <ToolbarText text={projectTitle} size="xlarge-fixed" headingLevel={2} />,
            toggle: { name: 'Files', action: `${id}:files` },
          },
          content: navigator,
        }}
        rightRail={{
          label: 'Inspector',
          size: state.inspector.size.value,
          collapsed: state.inspector.collapsed.value,
          overlaid: state.inspector.overlay.value,
          responsiveOverlayAt: 1080,
          resizable: { min: 240, max: 480 },
          toolbar: {
            label: 'Inspector',
            title: <ToolbarText text={inspectorTitle} size="xlarge-fixed" headingLevel={2} />,
            toggle: { name: 'Inspector', action: `${id}:inspector` },
          },
          content: inspector,
        }}
      />
    </div>
  );
}

export function wireReviewWorkbench(root: HTMLElement, id: string, state: ReviewWorkbenchState) {
  const stopWorkbench = wireWorkbench(root, {
    id,
    panels: {
      leftRail: state.files,
      rightRail: { ...state.inspector, keepFocusedOpen: true },
    },
  });
  const controller = new AbortController();

  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLButtonElement>('button[data-action]');
      const action = control?.dataset.action;
      const panel = action === `${id}:files` ? state.files : action === `${id}:inspector` ? state.inspector : null;
      if (panel === null || control === null || action === undefined) return;

      const wasFocused = document.activeElement === control;
      panel.collapsed.value = !panel.collapsed.value;
      if (wasFocused) {
        requestAnimationFrame(() => {
          if (!control.isConnected && document.activeElement === document.body) {
            root.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(action)}"]`)?.focus();
          }
        });
      }
    },
    { signal: controller.signal },
  );

  return () => {
    controller.abort();
    stopWorkbench();
  };
}
