import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const commit = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
// engine.json rides inside the archive so the package names its own release: an administrator
// applying a downloaded package has no engine checkout to read it from.
const tarball = execFileSync('git', [
  'archive', '--format=tar.gz', commit, '--', 'workbench-connector', 'sync', 'engine.json',
]);
const bundleHash = `sha256:${createHash('sha256').update(tarball).digest('hex')}`;
const { engineRelease, protocol } = JSON.parse(readFileSync('engine.json', 'utf8'));

mkdirSync('dist', { recursive: true });
writeFileSync('dist/candidate.tar.gz', tarball);
writeFileSync('dist/manifest.json', JSON.stringify({ engineRelease, protocol, commit, bundleHash }, null, 2) + '\n');

console.log(`candidate: dist/candidate.tar.gz`);
console.log(`release:   ${engineRelease} (protocol ${protocol})`);
console.log(`commit:    ${commit}`);
console.log(`bundle:    ${bundleHash}`);
