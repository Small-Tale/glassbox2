import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { List } from '@kerfjs/ui/list';
import { ListHeader } from '@kerfjs/ui/list-header';
import { ListInsetText } from '@kerfjs/ui/list-inset-text';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { closeDialog, DialogSurface, openDialog } from '@kerfjs/ui/surface-scaffold';
import { Text } from '@kerfjs/ui/text';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { PlugZap } from 'lucide';

import type { Format, Readiness, RendererState, Requirement, RequirementState } from './renderer-state.js';

// HS2-Q9TXER: a plain modal dialog, like the other settings dialogs (see GB2-NV3Y0E).
/* eslint-disable kerfjs/ui-wiring */

const device = deviceClass();

export function RendererAction({ id }: { id: string }) {
  return (
    <ToolbarControlGroup label="Diagram Renderers" appearance="borderless" content="icon" single>
      <ToolbarButton
        action={`${id}:open`}
        ariaLabel="Diagram Renderers"
        title="Diagram Renderers"
        icon={<LucideIcon icon={PlugZap} name="plug-zap" />}
      />
    </ToolbarControlGroup>
  );
}

const states: Record<Format['state'], string> = {
  ready: 'Ready',
  needs_setup: 'Needs Setup',
  unavailable: 'Needs a Renderer',
  unchecked: 'Not Checked',
};

const problems: Record<Exclude<RequirementState, 'ok'>, string> = {
  unset: 'is not set',
  relative: 'must be an absolute path',
  missing: 'does not point to a file',
};

function need({ label, variable, state, path }: Requirement) {
  if (state === 'ok') return `${label}: found`;
  return `${label}: set ${variable} to its absolute path (${path === undefined ? problems[state] : `${path} ${problems[state]}`}).`;
}

function Renderer({ renderer }: { renderer: Readiness['renderer'] }) {
  switch (renderer.state) {
    case 'not_configured':
      return (
        <StateBanner
          tone="info"
          title="No Renderer Configured"
          detail={`Set ${renderer.variable} to the absolute path of a trusted renderer executable, then restart Glassbox. Diagram files open as source until then.`}
        />
      );
    case 'missing':
      return (
        <StateBanner
          tone="warning"
          title="Renderer Not Found"
          detail={`${renderer.path ?? 'The configured path'} is not an absolute path to a file. Fix ${renderer.variable} and restart Glassbox.`}
        />
      );
    case 'local':
      return (
        <ListInsetText>
          <Text weight="strong" flush>
            Local Diagram Adapter
          </Text>
          <Text tone="quiet" size="compact" wrap="anywhere" flush>
            {renderer.path}
          </Text>
        </ListInsetText>
      );
    case 'custom':
      return (
        <ListInsetText>
          <Text weight="strong" flush>
            Custom Renderer
          </Text>
          <Text tone="quiet" size="compact" wrap="anywhere" flush>
            {renderer.path}
          </Text>
          <Text tone="quiet" size="compact" flush>
            Glassbox cannot tell which formats it supports; each render reports its own failure.
          </Text>
        </ListInsetText>
      );
  }
}

export function RendererDialog({
  id,
  state,
  embedded = false,
}: {
  id: string;
  state: RendererState;
  embedded?: boolean;
}) {
  const readiness = state.readiness.value;
  const loading = state.loading.value;
  const error = state.error.value;
  return (
    <DialogSurface
      id={id}
      className="diagram-renderers"
      label="Diagram Renderers"
      presentation={embedded ? 'embedded' : device.value.compact ? 'fullscreen' : 'modal'}
      preferredWidth={px(580)}
      bodyInset="none"
      rootAttributes={{ 'data-key': id }}
      footer={
        <>
          <Button action={`${id}:refresh`} emphasis="plain" disabled={loading}>
            Check Again
          </Button>
          <Button action={`${id}:close`} emphasis="secondary">
            Close
          </Button>
        </>
      }
    >
      <List gap>
        {error === '' ? null : (
          <StateBanner tone="danger" urgency="alert" title="Renderer Status Error" detail={error} />
        )}
        {readiness === null ? (
          <EmptyState
            busy={loading}
            title={loading ? 'Checking Renderers' : 'Renderers Unavailable'}
            detail={loading ? undefined : 'Renderer readiness could not be read.'}
          />
        ) : (
          <>
            <ListHeader label="Renderer" />
            <Renderer renderer={readiness.renderer} />
            <ListHeader label="Diagram Formats" />
            {readiness.formats.map((format) => (
              <ListInsetText rootAttributes={{ 'data-renderer-format': format.id }}>
                <Text weight="strong" flush>{`${format.name} · ${format.extensions.join(', ')}`}</Text>
                <Text flush>{states[format.state]}</Text>
                {format.requirements.map((requirement) => (
                  <Text tone="quiet" size="compact" wrap="anywhere" flush>
                    {need(requirement)}
                  </Text>
                ))}
                {format.state === 'needs_setup' ? (
                  <Text tone="quiet" size="compact" wrap="anywhere" flush>{`Install it from ${format.install}`}</Text>
                ) : null}
              </ListInsetText>
            ))}
            <Text tone="quiet" controlMargins="rl">
              Check Again re-reads these paths, so a tool installed since Glassbox started is noticed. A change to a
              variable needs a restart. Glassbox never installs or runs a tool from this dialog.
            </Text>
          </>
        )}
      </List>
    </DialogSurface>
  );
}

export function wireRendererDialog(root: HTMLElement, id: string, state: RendererState) {
  const controller = new AbortController();
  const dialog = () => root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === `${id}:open`) {
        const modal = dialog();
        if (modal === null) return;
        void state.refresh();
        openDialog(modal);
      }
      if (action === `${id}:close`) {
        const modal = dialog();
        if (modal !== null) closeDialog(modal);
      }
      if (action === `${id}:refresh`) void state.refresh();
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
