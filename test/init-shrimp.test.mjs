import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, stat, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {manifest} from '../workbench-connector/oversoul/scripts/linked-repo.mjs';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'init-shrimp.mjs');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function makePackage(root, {engineRelease = '0.1.0'} = {}) {
  const dir = join(root, 'package-' + engineRelease);
  const stage = join(dir, 'stage');
  for (const part of ['oversoul', 'bootstrap', 'shared']) {
    await mkdir(join(stage, 'workbench-connector', part), {recursive: true});
  }
  await writeFile(join(stage, 'workbench-connector', 'bootstrap', 'connect.mjs'), `// bootstrap ${engineRelease}\n`);
  await writeFile(join(stage, 'workbench-connector', 'shared', 'fs.mjs'), `// shared ${engineRelease}\n`);
  await writeFile(join(stage, 'workbench-connector', 'oversoul', 'SKILL.md'), `---\nname: oversoul\n---\npayload ${engineRelease}\n`);
  await writeFile(join(stage, 'engine.json'), JSON.stringify({engineRelease, protocol: 1}, null, 2) + '\n');
  await mkdir(join(stage, 'sync'), {recursive: true});
  await writeFile(join(stage, 'sync', 'cli.mjs'), `// sync cli ${engineRelease}\n`);

  const tarball = join(dir, 'candidate.tar.gz');
  execFileSync('tar', ['-c', '-z', '-f', tarball, '-C', stage, 'workbench-connector', 'sync', 'engine.json']);
  const bundleHash = 'sha256:' + createHash('sha256').update(await readFile(tarball)).digest('hex');
  const commit = '0'.repeat(40);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({engineRelease, protocol: 1, commit, bundleHash}, null, 2) + '\n');
  return {dir, tarball, bundleHash, commit};
}

const run = (target, pkg, ...args) =>
  spawnSync(process.execPath, [script, '--target', target, '--package', pkg.tarball, ...args], {encoding: 'utf8'});
const parse = r => JSON.parse(r.stdout);

test('a new instance is scaffolded, committed, and carries the engine payload', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'init-shrimp-test-')));
  const pkg = await makePackage(root);
  const target = join(root, 'new-shrimp');

  const r = run(target, pkg, '--yes', '--repository', 'Bossax/new-shrimp', '--name', 'New Shrimp');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = parse(r);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.equal(result.engineRelease, '0.1.0');
  assert.match(result.commit, /^[0-9a-f]{40}$/);

  for (const folder of ['work', 'knowledge', 'proposals', 'decisions', 'tasks', 'archive']) {
    assert.equal(await exists(join(target, folder, '.gitkeep')), true, `missing ${folder}`);
  }
  assert.equal(await exists(join(target, '.shrimp', 'system', 'connector', 'oversoul', 'SKILL.md')), true);
  assert.equal(await exists(join(target, '.shrimp', 'system', 'sync', 'cli.mjs')), true);
  assert.equal(await exists(join(target, '.github', 'workflows', 'notion.yml')), true);

  const release = JSON.parse(await readFile(join(target, '.shrimp', 'release.json'), 'utf8'));
  assert.equal(release.bundleHash, pkg.bundleHash);
  assert.equal(release.sourceCommit, pkg.commit);

  const project = JSON.parse(await readFile(join(target, '.shrimp', 'project.json'), 'utf8'));
  assert.equal(project.repository, 'Bossax/new-shrimp');
  assert.equal(project.branch, 'main');

  const readme = await readFile(join(target, 'README.md'), 'utf8');
  assert.match(readme, /New Shrimp/);
  assert.doesNotMatch(readme, /\{\{/);

  assert.equal(git(target, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(target, 'status', '--porcelain'), '');
});

test('the generated protocol manifest passes the gate-time validator', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'init-shrimp-protocol-')));
  const pkg = await makePackage(root);
  const target = join(root, 'protocol-shrimp');

  const r = run(target, pkg, '--yes', '--repository', 'Bossax/protocol-shrimp');
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const resolved = await manifest(target, 'https://github.com/Bossax/protocol-shrimp.git');
  assert.equal(resolved.version, 1);
  assert.deepEqual(Object.keys(resolved.capabilities).sort(), ['compare', 'dashboard', 'doctor', 'list', 'publish']);
  assert.equal(resolved.capabilities.publish.context, 'actions');
  assert.match(resolved.capabilities.list.entrypoint, /sync[\\/]cli\.mjs$/);
});

test('a plan run reports what it would create and writes nothing', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'init-shrimp-plan-')));
  const pkg = await makePackage(root);
  const target = join(root, 'planned-shrimp');

  const r = run(target, pkg, '--repository', 'Bossax/planned-shrimp');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = parse(r);
  assert.equal(result.status, 'planned');
  assert.equal(result.steps.find(s => s.step === 'git commit').action, 'create');
  assert.equal(await exists(target), false);
});

test('a non-empty target is refused', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'init-shrimp-occupied-')));
  const pkg = await makePackage(root);
  const target = join(root, 'occupied');
  await mkdir(target, {recursive: true});
  await writeFile(join(target, 'existing.md'), 'someone already works here\n');

  const r = run(target, pkg, '--yes', '--repository', 'Bossax/occupied');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const result = parse(r);
  assert.equal(result.status, 'blocked');
  assert.equal(await exists(join(target, '.shrimp')), false);
});

test('omitted Notion identifiers stay placeholders and a missing repository is refused', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'init-shrimp-config-')));
  const pkg = await makePackage(root);

  const scaffolded = join(root, 'placeholder-shrimp');
  const r = run(scaffolded, pkg, '--yes', '--repository', 'Bossax/placeholder-shrimp', '--notion-tasks', '24f1abc');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const project = JSON.parse(await readFile(join(scaffolded, '.shrimp', 'project.json'), 'utf8'));
  assert.equal(project.notion.tasks, '24f1abc');
  assert.equal(project.notion.threads, 'THREADS_DB_ID');
  assert.equal(project.notion.dashboardBlock, 'DASHBOARD_BLOCK_ID');

  const nameless = run(join(root, 'nameless-shrimp'), pkg, '--yes');
  assert.equal(nameless.status, 1, nameless.stdout + nameless.stderr);
  assert.equal(parse(nameless).status, 'invalid');
});
