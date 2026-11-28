import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const versionLabel = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/u;
const artifactName = /^[a-z0-9-]+\.(png|svg)$/u;
const checksum = /^[a-f0-9]{64}$/u;
const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const sceneId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const manifestName = 'manifest.json';

export const defaultArchiveRoot = 'demo-output/versions';

export function archivePath(root, version) {
  if (typeof version !== 'string' || !versionLabel.test(version)) {
    throw new Error('Use a version label with letters, numbers, periods, hyphens, underscores or plus signs');
  }
  return resolve(root, version);
}

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function artifactChecksums(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts = entries.filter(({ name }) => name !== manifestName).sort((a, b) => a.name.localeCompare(b.name));
  if (artifacts.length === 0) throw new Error('The archive has no demo artifacts');
  for (const entry of artifacts) {
    if (!entry.isFile() || !artifactName.test(entry.name)) {
      throw new Error(`Unexpected demo archive entry ${entry.name}`);
    }
  }
  return Object.fromEntries(
    await Promise.all(
      artifacts.map(async ({ name }) => [
        name,
        createHash('sha256')
          .update(await readFile(join(directory, name)))
          .digest('hex'),
      ]),
    ),
  );
}

export async function recordArchive(root, version, source, capture) {
  const destination = archivePath(root, version);
  if (await exists(destination)) throw new Error(`Demo archive ${version} already exists`);
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, '.capture-'));
  try {
    const selection = await capture(staging);
    if (selection === null) return false;
    const manifest = {
      schema: 1,
      version,
      source,
      platform: process.platform,
      architecture: process.arch,
      selection,
      artifacts: await artifactChecksums(staging),
    };
    await writeFile(join(staging, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    if (await exists(destination)) throw new Error(`Demo archive ${version} already exists`);
    await rename(staging, destination);
    return true;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function readArchive(root, version) {
  const path = archivePath(root, version);
  const directory = await exists(path);
  if (!directory?.isDirectory()) throw new Error(`Demo archive ${version} is missing`);
  const manifestFile = join(path, manifestName);
  if (!(await exists(manifestFile))?.isFile()) throw new Error(`Demo archive ${version} has no manifest`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (
    manifest?.schema !== 1 ||
    manifest.version !== version ||
    typeof manifest.platform !== 'string' ||
    typeof manifest.architecture !== 'string' ||
    typeof manifest.source?.commit !== 'string' ||
    !revision.test(manifest.source.commit) ||
    typeof manifest.source.dirty !== 'boolean' ||
    !Array.isArray(manifest.selection) ||
    manifest.selection.length === 0 ||
    new Set(manifest.selection).size !== manifest.selection.length ||
    manifest.selection.some((id) => typeof id !== 'string' || !sceneId.test(id)) ||
    manifest.artifacts === null ||
    typeof manifest.artifacts !== 'object' ||
    Array.isArray(manifest.artifacts) ||
    Object.entries(manifest.artifacts).some(
      ([name, hash]) => !artifactName.test(name) || typeof hash !== 'string' || !checksum.test(hash),
    )
  ) {
    throw new Error(`Demo archive ${version} has an invalid manifest`);
  }
  const actual = await artifactChecksums(path);
  const changes = compareArtifacts(manifest.artifacts, actual);
  if (Object.values(changes).some((entries) => entries.length > 0)) {
    throw new Error(`Demo archive ${version} differs from its manifest: ${JSON.stringify(changes)}`);
  }
  return manifest;
}

export function compareArtifacts(baseline, current) {
  return {
    added: Object.keys(current)
      .filter((name) => !Object.hasOwn(baseline, name))
      .sort(),
    removed: Object.keys(baseline)
      .filter((name) => !Object.hasOwn(current, name))
      .sort(),
    changed: Object.keys(current)
      .filter((name) => Object.hasOwn(baseline, name) && baseline[name] !== current[name])
      .sort(),
  };
}

export async function compareArchives(root, baselineVersion, currentVersion) {
  const [baseline, current] = await Promise.all([
    readArchive(root, baselineVersion),
    readArchive(root, currentVersion),
  ]);
  if (baseline.platform !== current.platform || baseline.architecture !== current.architecture) {
    throw new Error('Compare archives captured on the same platform and architecture');
  }
  return {
    baseline: { version: baseline.version, source: baseline.source, selection: baseline.selection },
    current: { version: current.version, source: current.source, selection: current.selection },
    ...compareArtifacts(baseline.artifacts, current.artifacts),
  };
}
