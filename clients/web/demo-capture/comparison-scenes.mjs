import { validateScene } from './scene.mjs';
import { scenes } from './scenes.mjs';

const windows = { wide: 1440, medium: 900, narrow: 400 };
const states = ['loading', 'empty', 'error'];
const schemes = ['light', 'dark'];

/** These states open real repositories or hold the real files request at the browser boundary. */
const workbenchStates = Object.entries(windows).flatMap(([widthName, width]) =>
  schemes.flatMap((scheme) =>
    states.map((state) =>
      validateScene({
        id: `workbench-${state}-${widthName}-${scheme}`,
        title: `${state} Workbench at ${widthName} width in ${scheme}`,
        suites: ['comparison'],
        kind: 'still',
        viewport: { width, height: 900 },
        scheme,
        frames: [{ name: state, state, steps: [] }],
      }),
    ),
  ),
);

export const comparisonScenes = [...scenes, ...workbenchStates];
