// HS2-5HS40W: the scene-definition format shared by the public and comparison demo suites.
//
// A scene is plain data. It names its suites, one fixed window (size, scheme, locale, time zone), and one or more
// frames. A frame is a list of declarative steps followed by a named ready state; the runner advances only when the
// app reports that state, never after a pause. Loading, empty and error frames appear only when a scene asks for them.

export const suiteNames = ['public', 'comparison'];
export const sceneKinds = ['still', 'animation'];
export const schemes = ['light', 'dark'];
/** Opt-in frame states. Every other frame is a settled review, so a capture never shows a spinner by accident. */
export const optInStates = ['loading', 'empty', 'error'];
/** The named states a frame may wait for. The runner owns what each one means in the real workbench. */
export const readyStates = [
  'source-entry',
  'review',
  'diff',
  'comment-saved',
  'media',
  'analysis-risk',
  'analysis-narrative',
  'analysis-note',
];
export const actions = [
  'open-comparison',
  'select-file',
  'comment',
  'appearance',
  'order-files',
  'open-ai-note',
  'widen-file-rail',
];
const analysisOrders = ['risk', 'narrative'];

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function fail(path, message) {
  throw new Error(`scene ${path}: ${message}`);
}

function positive(path, value) {
  if (!Number.isInteger(value) || value <= 0) fail(path, 'must be a positive integer');
}

function validateStep(path, step) {
  if (typeof step !== 'object' || step === null || !actions.includes(step.action)) {
    fail(path, `action must be one of ${actions.join(', ')}`);
  }
  if (step.action === 'select-file' && (typeof step.name !== 'string' || step.name === '')) {
    fail(path, 'select-file needs a file name');
  }
  if (step.action === 'comment') {
    if (!Number.isInteger(step.line) || step.line < 1) fail(path, 'comment needs a line number');
    if (typeof step.text !== 'string' || step.text === '') fail(path, 'comment needs text');
  }
  if (step.action === 'appearance' && !schemes.includes(step.scheme)) {
    fail(path, `appearance needs a scheme of ${schemes.join(', ')}`);
  }
  if (step.action === 'order-files' && !analysisOrders.includes(step.order)) {
    fail(path, 'order-files needs a risk or narrative order');
  }
}

function validateFrame(path, frame, analysis) {
  if (typeof frame !== 'object' || frame === null) fail(path, 'must be an object');
  if (typeof frame.name !== 'string' || !identifier.test(frame.name)) fail(`${path}.name`, 'must be a kebab-case name');
  if (frame.state !== undefined && !optInStates.includes(frame.state)) {
    fail(`${path}.state`, `must be one of ${optInStates.join(', ')}`);
  }
  if (frame.state === undefined && !readyStates.includes(frame.ready)) {
    fail(`${path}.ready`, `must be one of ${readyStates.join(', ')}`);
  }
  if (!Array.isArray(frame.steps)) fail(`${path}.steps`, 'must be a list');
  frame.steps.forEach((step, index) => {
    validateStep(`${path}.steps[${index}]`, step);
  });
  if (
    analysis === undefined &&
    ((typeof frame.ready === 'string' && frame.ready.startsWith('analysis-')) ||
      frame.steps.some((step) => step.action === 'order-files' || step.action === 'open-ai-note'))
  ) {
    fail(path, 'analysis frames need the fixture provider');
  }
  if (frame.hold !== undefined) positive(`${path}.hold`, frame.hold);
}

/** Checks one scene and returns it, or throws a message that names the offending path. */
export function validateScene(scene) {
  if (typeof scene !== 'object' || scene === null) fail('', 'must be an object');
  if (typeof scene.id !== 'string' || !identifier.test(scene.id)) fail('.id', 'must be a kebab-case id');
  if (typeof scene.title !== 'string' || scene.title === '') fail('.title', 'must be a non-empty string');
  if (!Array.isArray(scene.suites) || scene.suites.length === 0 || !scene.suites.every((s) => suiteNames.includes(s))) {
    fail('.suites', `must list one or more of ${suiteNames.join(', ')}`);
  }
  if (!sceneKinds.includes(scene.kind)) fail('.kind', `must be one of ${sceneKinds.join(', ')}`);
  positive('.viewport.width', scene.viewport?.width);
  positive('.viewport.height', scene.viewport?.height);
  if (!schemes.includes(scene.scheme)) fail('.scheme', `must be one of ${schemes.join(', ')}`);
  if (scene.analysis !== undefined && scene.analysis !== 'fixture') fail('.analysis', 'must be fixture');
  if (!Array.isArray(scene.frames) || scene.frames.length === 0) fail('.frames', 'needs at least one frame');
  scene.frames.forEach((frame, index) => {
    validateFrame(`.frames[${index}]`, frame, scene.analysis);
  });
  const names = scene.frames.map((frame) => frame.name);
  if (new Set(names).size !== names.length) fail('.frames', 'frame names must be unique');
  if (scene.kind === 'still' && scene.frames.length !== 1) fail('.frames', 'a still has exactly one frame');
  if (scene.kind === 'animation' && scene.frames.length < 2) fail('.frames', 'an animation needs at least two frames');
  return scene;
}

/** The scenes of one suite, in definition order. */
export function suiteScenes(scenes, suite) {
  if (!suiteNames.includes(suite)) throw new Error(`unknown suite ${suite}; use ${suiteNames.join(' or ')}`);
  return scenes.filter((scene) => scene.suites.includes(suite));
}

/**
 * Compares the artifacts of repeated runs of one scene. `runs` is a list of `{ file: Buffer }` maps. Returns the
 * names of artifacts whose bytes differ from the first run, or that one run produced and another did not.
 */
export function differingArtifacts(runs) {
  if (runs.length < 2) return [];
  const [first, ...rest] = runs;
  const names = new Set(runs.flatMap((run) => Object.keys(run)));
  const differing = [];
  for (const name of [...names].sort()) {
    const reference = first[name];
    if (rest.some((run) => reference === undefined || run[name] === undefined || !reference.equals(run[name]))) {
      differing.push(name);
    }
  }
  return differing;
}
