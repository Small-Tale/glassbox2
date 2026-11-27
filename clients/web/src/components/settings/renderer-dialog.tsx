import { Button } from '@kerfjs/ui/button';
import { px } from '@kerfjs/ui/css-values';
import { deviceClass } from '@kerfjs/ui/device-class';
import { Disclosure } from '@kerfjs/ui/disclosure';
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

import { copyText } from './copy-text.js';
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

/** The plain sentence for a requirement; the variable and path are in its disclosure (GB2-SWK512). */
const plainProblems: Record<Exclude<RequirementState, 'ok'>, string> = {
  unset: 'not set up',
  relative: 'needs an absolute path',
  missing: 'file not found',
};

function need({ label, state }: Requirement) {
  return state === 'ok' ? `${label}: found` : `${label}: ${plainProblems[state]}.`;
}

/** Copies the path beside it; the dialog handler reads the value from the button. */
function copyPath(id: string, path: string) {
  return (
    <Button action={`${id}:copy`} emphasis="plain" size="compact" rootAttributes={{ 'data-copy-value': path }}>
      Copy Path
    </Button>
  );
}

/** What to set and where it points now, kept one press away from the plain sentence. */
function setup(id: string, variable: string, path: string | undefined, restart: boolean) {
  return (
    <Disclosure title="How to set this up" size="compact" appearance="plain">
      <Text size="compact" wrap="anywhere" controlMargins="rl">
        {`Set ${variable} to the absolute path of the tool${restart ? ', then restart Glassbox' : ''}.`}
      </Text>
      {path === undefined ? null : (
        <>
          <Text size="compact" font="monospace" wrap="anywhere" controlMargins="rl">
            {`Currently ${path}`}
          </Text>
          {copyPath(id, path)}
        </>
      )}
    </Disclosure>
  );
}

function Renderer({ id, renderer }: { id: string; renderer: Readiness['renderer'] }) {
  switch (renderer.state) {
    case 'not_configured':
      return (
        <>
          <StateBanner
            tone="info"
            title="No Renderer Configured"
            detail="Diagram files open as source until a trusted renderer is set up."
          />
          {setup(id, renderer.variable, undefined, true)}
        </>
      );
    case 'missing':
      return (
        <>
          <StateBanner
            tone="warning"
            title="Renderer Not Found"
            detail="The configured renderer is not an absolute path to a file. Diagram files open as source."
          />
          {setup(id, renderer.variable, renderer.path, true)}
        </>
      );
    case 'local':
      return (
        <ListInsetText>
          <Text weight="strong" flush>
            Local Diagram Adapter
          </Text>
          <Text tone="quiet" size="compact" flush>
            Built in; no setup needed.
          </Text>
          {renderer.path === undefined ? null : (
            <Disclosure title="Location" size="compact" appearance="plain">
              <Text size="compact" font="monospace" wrap="anywhere" controlMargins="rl">
                {renderer.path}
              </Text>
              {copyPath(id, renderer.path)}
            </Disclosure>
          )}
        </ListInsetText>
      );
    case 'custom':
      return (
        <ListInsetText>
          <Text weight="strong" flush>
            Custom Renderer
          </Text>
          <Text tone="quiet" size="compact" flush>
            Glassbox cannot tell which formats it supports; each render reports its own failure.
          </Text>
          {renderer.path === undefined ? null : (
            <Disclosure title="Location" size="compact" appearance="plain">
              <Text size="compact" font="monospace" wrap="anywhere" controlMargins="rl">
                {renderer.path}
              </Text>
              {copyPath(id, renderer.path)}
            </Disclosure>
          )}
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
            <Renderer id={id} renderer={readiness.renderer} />
            <ListHeader label="Diagram Formats" />
            {readiness.formats.map((format) => (
              <ListInsetText rootAttributes={{ 'data-renderer-format': format.id }}>
                <Text weight="strong" flush>{`${format.name} · ${format.extensions.join(', ')}`}</Text>
                <Text flush>{states[format.state]}</Text>
                {format.requirements.map((requirement) => (
                  <>
                    <Text tone="quiet" size="compact" wrap="anywhere" flush>
                      {need(requirement)}
                    </Text>
                    {requirement.state === 'ok' ? null : setup(id, requirement.variable, requirement.path, false)}
                  </>
                ))}
                {format.state === 'needs_setup' ? (
                  <Text tone="quiet" size="compact" wrap="anywhere" flush>{`Install it from ${format.install}`}</Text>
                ) : null}
              </ListInsetText>
            ))}
            <Text tone="quiet" controlMargins="rl">
              Check Again notices a tool installed since Glassbox started. Glassbox never installs or runs a tool from
              this dialog. A changed setting needs a restart.
            </Text>
            {state.copied.value === '' ? null : (
              <Text role="status" tone="quiet" controlMargins="rl">
                {state.copied.value}
              </Text>
            )}
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
      if (action === `${id}:copy`) {
        const value = event.target.closest<HTMLElement>('[data-copy-value]')?.dataset.copyValue;
        if (value !== undefined) void copyText(value).then((message) => (state.copied.value = message));
      }
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
  };
}
