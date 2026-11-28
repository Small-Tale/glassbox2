// HS2-5HS40W: a disposable, fully local Glassbox host over fixed fixture repositories.
//
// Every input a capture can see is fixed: the repositories are rebuilt at the same path with the same file contents
// and the same author and commit times, and the host runs with its own empty settings and feedback folders and with
// optional tools switched off. Analysis scenes opt in to a local test executable.

import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
const executable = join(root, 'target', 'debug', `glassbox-server${process.platform === 'win32' ? '.exe' : ''}`);
const assets = join(root, 'clients', 'web', 'dist');
/** The same instant is every commit's author and committer time. */
export const fixtureTime = '2026-01-15T10:00:00Z';
// The repository path is typed into the form, so it is visible in captures. On macOS and Linux it is a short fixed
// path rather than the per-user temporary folder; Windows has no such location and uses its temporary folder.
const fixtureRoot = process.platform === 'win32' ? join(tmpdir(), 'glassbox-demo') : '/tmp/glassbox-demo';

export async function buildAnalysisFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'glassbox-demo-provider-'));
  const executable = join(directory, `analysis-fixture${process.platform === 'win32' ? '.exe' : ''}`);
  const source = join(root, 'crates', 'glassbox-server', 'tests', 'fixtures', 'analysis_provider.rs');
  const stop = () => rm(directory, { recursive: true, force: true });
  try {
    execFileSync('rustc', ['--edition=2024', source, '-o', executable], { windowsHide: true });
    await writeFile(
      join(directory, 'demo.json'),
      JSON.stringify({ version: 1, id: 'demo', name: 'Demo Analysis Fixture', executable }),
    );
    return { directory, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function mark(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e7eaef"/><circle cx="160" cy="90" r="62" fill="${color}"/></svg>\n`;
}

const reviewBefore = `export type Note = { line: number; text: string };

export function summarize(notes: Note[]): string {
  return notes.map((note) => note.text).join('\\n');
}

export function count(notes: Note[]): number {
  return notes.length;
}
`;

const reviewAfter = `export type Note = { line: number; text: string; resolved: boolean };

export function summarize(notes: Note[]): string {
  return notes
    .filter((note) => !note.resolved)
    .map((note) => \`Line \${note.line}: \${note.text}\`)
    .join('\\n');
}

export function count(notes: Note[]): number {
  return notes.filter((note) => !note.resolved).length;
}
`;

function git(repo, ...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_AUTHOR_DATE: fixtureTime, GIT_COMMITTER_DATE: fixtureTime },
    },
  );
}

async function repository(name, changes) {
  const repo = join(fixtureRoot, name);
  await rm(repo, { recursive: true, force: true });
  await mkdir(repo, { recursive: true });
  git(repo, 'init', '-q', '--initial-branch=review');
  await writeFile(join(repo, 'review.ts'), reviewBefore);
  await writeFile(join(repo, 'mark.svg'), mark('#506b91'));
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'Start the review notes');
  if (changes) {
    await writeFile(join(repo, 'review.ts'), reviewAfter);
    await writeFile(join(repo, 'mark.svg'), mark('#3b7c68'));
  }
  return repo;
}

/**
 * Starts the host and returns its address with the fixture paths. `stop` shuts the host down and removes the run's
 * private folders; the fixture repositories stay at their fixed paths so their text is the same in every capture.
 */
export async function startHost(analysisFixture) {
  const changed = await repository('Fieldnotes', true);
  const clean = await repository('Quiet', false);
  const beforeFolder = join(fixtureRoot, 'Before');
  const afterFolder = join(fixtureRoot, 'After');
  await mkdir(beforeFolder, { recursive: true });
  await mkdir(afterFolder, { recursive: true });
  const before = join(beforeFolder, 'release-notes.txt');
  const after = join(afterFolder, 'release-notes.txt');
  await writeFile(before, 'Fieldnotes release\nStatus: draft\nAudience: review team\n');
  await writeFile(after, 'Fieldnotes release\nStatus: approved\nAudience: all reviewers\n');
  const scratch = await mkdtemp(join(tmpdir(), 'glassbox-demo-host-'));
  const settings = join(scratch, 'settings');
  if (analysisFixture) {
    await mkdir(settings);
    await writeFile(
      join(settings, 'settings.json'),
      JSON.stringify({
        version: 1,
        appearance: 'system',
        analysis: { provider: 'demo', model: 'fixture', guidance_topics: [] },
      }),
    );
  }
  const host = spawn(executable, ['--assets', assets], {
    cwd: root,
    env: {
      ...process.env,
      GLASSBOX_SETTINGS_DIRECTORY: settings,
      GLASSBOX_FEEDBACK_DIRECTORY: join(scratch, 'feedback'),
      GLASSBOX_ANALYSIS_CACHE_DIRECTORY: join(scratch, 'analysis'),
      GLASSBOX_CONTENT_RENDERER: '',
      GLASSBOX_GRAPHVIZ_EXECUTABLE: '',
      GLASSBOX_MERMAID_EXECUTABLE: '',
      GLASSBOX_JAVA_EXECUTABLE: '',
      GLASSBOX_PLANTUML_JAR: '',
      GLASSBOX_AI_PROVIDER_DIRECTORY: analysisFixture?.directory ?? '',
      GLASSBOX_AI_PROVIDER: '',
      GLASSBOX_AI_TRUSTED_PROVIDERS: analysisFixture ? 'demo' : '',
      GLASSBOX_FIXTURE_DEMO_COMMIT: analysisFixture ? git(changed, 'rev-parse', 'HEAD').trim() : '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  const exited = new Promise((resolve) => {
    host.once('close', resolve);
  });
  const reader = createInterface({ input: host.stdout });
  const [address] = await Promise.race([
    once(reader, 'line', { signal: AbortSignal.timeout(15_000) }),
    once(host, 'exit').then(([code]) => {
      throw new Error(`Glassbox host exited before readiness with code ${code}`);
    }),
  ]);
  if (!/^127\.0\.0\.1:\d+$/u.test(address)) throw new Error(`Unexpected host address ${address}`);
  return {
    url: `http://${address}`,
    // `missing` is never created, so opening it fails with the host's real error.
    paths: { changed, clean, before, after, missing: join(fixtureRoot, 'Missing') },
    async stop() {
      reader.close();
      host.kill();
      await exited;
      await rm(scratch, { recursive: true, force: true });
    },
  };
}
