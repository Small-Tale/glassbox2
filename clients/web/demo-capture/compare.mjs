import { parseArgs } from 'node:util';

import { compareArchives, defaultArchiveRoot } from './archive.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    current: { type: 'string' },
    root: { type: 'string', default: defaultArchiveRoot },
  },
});
if (!values.baseline || !values.current) throw new Error('Supply --baseline and --current version labels');
const report = await compareArchives(values.root, values.baseline, values.current);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.added.length + report.removed.length + report.changed.length > 0 ? 1 : 0;
