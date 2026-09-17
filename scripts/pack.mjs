import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const commit = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const tarball = execFileSync('git', [
  'archive', '--format=tar.gz', commit, '--', 'workbench-connector',
]);
const bundleHash = `sha256:${createHash('sha256').update(tarball).digest('hex')}`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/candidate.tar.gz', tarball);
writeFileSync('dist/manifest.json', JSON.stringify({ commit, bundleHash }, null, 2) + '\n');

console.log(`candidate: dist/candidate.tar.gz`);
console.log(`commit:    ${commit}`);
console.log(`bundle:    ${bundleHash}`);
