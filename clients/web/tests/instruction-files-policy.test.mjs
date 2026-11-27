import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const claudeFile = new URL('../../../CLAUDE.md', import.meta.url);

// GB2-GGPNRA: CLAUDE.md only imports AGENTS.md; the managed sections live once, in AGENTS.md.
test('GB2-GGPNRA CLAUDE.md contains only the AGENTS.md import', { skip: !existsSync(claudeFile) }, () => {
  assert.equal(readFileSync(claudeFile, 'utf8').trim(), '@AGENTS.md');
});
