import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// HS2-0N4NPR: the dependency advisory gate and its exceptions are pinned as source so they cannot drift quietly.
const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const configs = ['.cargo/audit.toml', 'clients/web/src-tauri/.cargo/audit.toml'];

test('every advisory exception names its ticket, why it does not apply, and a future expiry', async () => {
  for (const path of configs) {
    const text = await read(path);
    const entries = [...text.matchAll(/^\s*"(RUSTSEC-\d{4}-\d{4})",?(.*)$/gmu)];
    const declared =
      (/^ignore = \[([\s\S]*?)^\]|^ignore = \[\]/mu.exec(text)?.[1] ?? '').match(/RUSTSEC-\d{4}-\d{4}/gu) ?? [];
    assert.equal(entries.length, declared.length, `${path}: every ignored advisory is on its own line with a reason`);
    for (const [, id, rest] of entries) {
      const match = /#\s*([A-Z0-9]+-[A-Z0-9]+): (.{20,}?);? expires (\d{4}-\d{2}-\d{2})\s*$/u.exec(rest);
      assert(match, `${path}: ${id} needs "# TICKET: reason; expires YYYY-MM-DD" on its line`);
      assert(
        new Date(`${match[3]}T00:00:00Z`) > new Date(),
        `${path}: the exception for ${id} expired on ${match[3]}; review it`,
      );
    }
  }
});

test('the gate audits all three lockfiles, in CI on every lockfile change and weekly', async () => {
  const script = await read('scripts/audit-dependencies.sh');
  for (const needle of [
    'npm audit --prefix clients/web --omit=dev',
    'npm audit --prefix clients/web --audit-level=high',
    'cargo audit',
    'clients/web/src-tauri',
  ]) {
    assert(script.includes(needle), `the script runs ${needle}`);
  }
  const workflow = await read('.github/workflows/audit.yml');
  for (const lockfile of ['clients/web/package-lock.json', 'Cargo.lock', 'clients/web/src-tauri/Cargo.lock']) {
    assert(workflow.includes(`'${lockfile}'`), `${lockfile} triggers the audit`);
  }
  assert(workflow.includes('schedule:') && workflow.includes('./scripts/audit-dependencies.sh'));
});
