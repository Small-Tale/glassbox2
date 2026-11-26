import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { RendererDialog, wireRendererDialog } from '../../../components/settings/renderer-dialog.js';
import { createRendererState, type Readiness } from '../../../components/settings/renderer-state.js';

const format = (id: string, name: string, extensions: string[], state: Readiness['formats'][number]['state']) => ({
  id,
  name,
  extensions,
  state,
  requirements: [],
  install: '',
});

const adapter = '/opt/glassbox/glassbox-render-local';
const fixtures: { id: string; label: string; readiness: Readiness }[] = [
  {
    id: 'demo-renderers-setup',
    label: 'Local Adapter Needing Setup',
    readiness: {
      renderer: { state: 'local', variable: 'GLASSBOX_CONTENT_RENDERER', path: adapter },
      formats: [
        {
          ...format('graphviz', 'Graphviz', ['.dot', '.gv'], 'ready'),
          requirements: [
            { label: 'Graphviz dot executable', variable: 'GLASSBOX_GRAPHVIZ_EXECUTABLE', state: 'ok' as const },
          ],
        },
        {
          ...format('mermaid', 'Mermaid', ['.mmd', '.mermaid'], 'needs_setup'),
          requirements: [
            { label: 'Mermaid CLI executable', variable: 'GLASSBOX_MERMAID_EXECUTABLE', state: 'unset' as const },
          ],
          install: 'https://github.com/mermaid-js/mermaid-cli',
        },
        {
          ...format('plantuml', 'PlantUML', ['.puml', '.plantuml'], 'needs_setup'),
          requirements: [
            {
              label: 'Java executable',
              variable: 'GLASSBOX_JAVA_EXECUTABLE',
              state: 'ok' as const,
            },
            {
              label: 'PlantUML jar',
              variable: 'GLASSBOX_PLANTUML_JAR',
              state: 'missing' as const,
              path: '/opt/plantuml/plantuml.jar',
            },
          ],
          install: 'https://plantuml.com/download',
        },
      ],
    },
  },
  {
    id: 'demo-renderers-none',
    label: 'No Renderer Configured',
    readiness: {
      renderer: { state: 'not_configured', variable: 'GLASSBOX_CONTENT_RENDERER' },
      formats: [
        format('graphviz', 'Graphviz', ['.dot', '.gv'], 'unavailable'),
        format('mermaid', 'Mermaid', ['.mmd', '.mermaid'], 'unavailable'),
        format('plantuml', 'PlantUML', ['.puml', '.plantuml'], 'unavailable'),
      ],
    },
  },
  {
    id: 'demo-renderers-custom',
    label: 'Custom Renderer',
    readiness: {
      renderer: { state: 'custom', variable: 'GLASSBOX_CONTENT_RENDERER', path: '/opt/team/diagram-renderer' },
      formats: [
        format('graphviz', 'Graphviz', ['.dot', '.gv'], 'unchecked'),
        format('mermaid', 'Mermaid', ['.mmd', '.mermaid'], 'unchecked'),
        format('plantuml', 'PlantUML', ['.puml', '.plantuml'], 'unchecked'),
      ],
    },
  },
];
const states = fixtures.map((fixture) => ({
  ...fixture,
  state: createRendererState(() => Promise.resolve(fixture.readiness)),
}));

export function RendererDialogDemo() {
  return (
    <CatalogExampleStack label="Diagram Renderers" rootAttributes={{ 'data-demo': 'renderer-dialog' }}>
      {states.map(({ id, label, state }) => (
        <CatalogExample label={label} viewport={{ width: 'full' }}>
          <RendererDialog id={id} state={state} embedded />
        </CatalogExample>
      ))}
    </CatalogExampleStack>
  );
}

export function wireRendererDialogDemo(root: HTMLElement) {
  const stops = states.map(({ id, state }) => {
    void state.refresh();
    return wireRendererDialog(root, id, state);
  });
  return () => {
    for (const stop of stops) stop();
  };
}
