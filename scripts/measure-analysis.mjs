import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';

const [hostBinary, adapterBinary, fixtureFilter, modeFilter] = process.argv.slice(2);
if (!hostBinary || !adapterBinary) {
  throw new Error('Usage: node scripts/measure-analysis.mjs <glassbox-server> <Apple adapter> [fixture] [mode]');
}

const scratch = await mkdtemp(join(tmpdir(), 'glassbox-analysis-benchmark-'));
const cases = {
  'timeout-adjustment': {
    'request.ts': [
      'export const requestTimeoutSeconds = 15;\n',
      'export const requestTimeoutSeconds = 30;\n',
    ],
  },
  'atomic-writer': {
    'store.ts': [
      'export async function save(path, value) {\n  await writeFile(path, value);\n}\n',
      'export async function save(path, value) {\n  const pending = await temporarySibling(path);\n  await writeFile(pending, value);\n  await rename(pending, path);\n}\n',
    ],
    'store.test.ts': [
      'test("writes a review", async () => {\n  await save(path, "one");\n  expect(await readFile(path)).toBe("one");\n});\n',
      'test("writes a review", async () => {\n  await save(path, "one");\n  expect(await readFile(path)).toBe("one");\n});\n\ntest("keeps concurrent writes complete", async () => {\n  await Promise.all([save(path, "one"), save(path, "two")]);\n  expect(["one", "two"]).toContain(await readFile(path));\n});\n',
    ],
  },
};

async function fixture(name, files) {
  const before = join(scratch, name, 'before');
  const after = join(scratch, name, 'after');
  await Promise.all([mkdir(before, { recursive: true }), mkdir(after, { recursive: true })]);
  await Promise.all(
    Object.entries(files).flatMap(([path, [oldText, newText]]) => [
      writeFile(join(before, path), oldText),
      writeFile(join(after, path), newText),
    ]),
  );
  return { kind: 'paths', before, after };
}

async function serve(registry, run) {
  const host = spawn(resolve(hostBinary), [], {
    env: {
      ...process.env,
      GLASSBOX_AI_PROVIDER_DIRECTORY: registry,
      GLASSBOX_AI_PROVIDER: 'apple',
      GLASSBOX_AI_MODEL: 'apple-foundation',
      GLASSBOX_AI_PROVIDER_SETTINGS: '{}',
      GLASSBOX_FEEDBACK_DIRECTORY: join(scratch, 'feedback'),
      GLASSBOX_ANALYSIS_CACHE_DIRECTORY: join(scratch, 'analysis-cache'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const output = createInterface({ input: host.stdout });
  try {
    const [address] = await Promise.race([
      once(output, 'line'),
      once(host, 'exit').then(([code]) => { throw new Error(`Host exited with ${code}`); }),
    ]);
    return await run(`http://${address}/api/v1/review/analysis`);
  } finally {
    output.close();
    if (host.exitCode === null && host.signalCode === null) {
      host.kill();
      await once(host, 'exit');
    }
  }
}

async function measure(url, source, mode) {
  const started = performance.now();
  const request = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, mode }),
  });
  if (!request.ok) throw new Error(await request.text());
  const { id } = await request.json();
  for (;;) {
    const response = await fetch(`${url}/${id}`);
    const job = await response.json();
    if (job.status !== 'running') {
      return { milliseconds: Math.round(performance.now() - started), status: job.status, message: job.message };
    }
    if (performance.now() - started > 180_000) throw new Error(`${mode} exceeded the measurement deadline`);
    await setTimeout(50);
  }
}

try {
  const registry = join(scratch, 'providers');
  await mkdir(registry);
  await writeFile(join(registry, 'apple.json'), JSON.stringify({
    version: 1,
    id: 'apple',
    name: 'Apple Foundation Models',
    executable: resolve(adapterBinary),
  }));

  for (const [name, files] of Object.entries(cases)) {
    if (fixtureFilter !== undefined && fixtureFilter !== name) continue;
    const source = await fixture(name, files);
    for (const mode of ['risk', 'narrative', 'guidance']) {
      if (modeFilter !== undefined && modeFilter !== mode) continue;
      const measurements = await serve(registry, async (url) => {
        const first = await measure(url, source, mode);
        const repeats = [];
        for (let repeat = 0; repeat < 3; repeat++) repeats.push(await measure(url, source, mode));
        return { first, repeats };
      });
      process.stdout.write(`${JSON.stringify({ fixture: name, mode, ...measurements })}\n`);
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
