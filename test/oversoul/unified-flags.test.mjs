import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {manifest, operate as operateReal} from '../../workbench-connector/oversoul/scripts/linked-repo.mjs';

const LINKED_REPO_SCRIPT = join(import.meta.dirname, '../../workbench-connector/oversoul/scripts/linked-repo.mjs');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();

async function fixture(customProtocol) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'unified-flags-test-')));
  const primary = join(root, 'primary'), remote = join(root, 'remote.git'), wb = join(root, 'wb'), wt = join(root, 'wt');
  await mkdir(primary); await mkdir(wb);
  git(root, 'init', '--bare', remote);
  git(primary, 'init', '-b', 'main');
  git(primary, 'config', 'user.name', 'Test');
  git(primary, 'config', 'user.email', 'test@example.invalid');
  git(primary, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(primary, 'AGENTS.md'), 'Test protocol');
  await writeFile(join(primary, 'entry.mjs'), 'console.log("HEALTH_OK");');

  const proto = customProtocol || {
    version: 1,
    repository: 'example/team',
    runtime: {nodeMajor: 24, nodeMinMinor: 11},
    instructions: ['AGENTS.md'],
    capabilities: {
      health: {
        context: 'interactive',
        description: 'Verify Notion connection and repository health',
        argv: ['entry.mjs'],
        options: [],
        documents: ['AGENTS.md'],
      },
      list: {
        context: 'interactive',
        description: 'List tracked items',
        argv: ['entry.mjs'],
        options: [],
        documents: ['AGENTS.md'],
      },
      publish: {
        context: 'actions',
        argv: ['entry.mjs'],
        options: [],
        documents: [],
      },
    },
  };

  await writeFile(join(primary, 'protocol.json'), JSON.stringify(proto));
  git(primary, 'add', '.');
  git(primary, 'commit', '-m', 'fixture');
  git(primary, 'remote', 'add', 'origin', remote);
  git(primary, 'push', '-u', 'origin', 'main');
  git(primary, 'worktree', 'add', '-b', 'workbench', wt, 'main');
  git(wt, 'branch', '--set-upstream-to', 'origin/main');
  git(primary, 'remote', 'set-url', 'origin', 'https://github.com/example/team.git');

  await symlink(wt, join(wb, 'Team'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(wb, '.linked-repos.json'), JSON.stringify({
    version: 1,
    targets: {
      Team: {
        path: 'Team',
        remote: 'https://github.com/example/team.git',
        branch: 'workbench',
        upstream: 'origin/main',
      },
    },
  }));
  return {root, primary, remote, wb, wt};
}

test('manifest validates capability description field', async () => {
  const f = await fixture();
  const m = await manifest(f.primary, 'https://github.com/example/team.git');
  assert.equal(m.capabilities.health.description, 'Verify Notion connection and repository health');
  assert.equal(m.capabilities.list.description, 'List tracked items');
  assert.equal(m.capabilities.publish.description, undefined);

  // Invalid non-string description fails
  const badRoot = await realpath(await mkdtemp(join(tmpdir(), 'bad-manifest-')));
  await writeFile(join(badRoot, 'AGENTS.md'), 'agents');
  await writeFile(join(badRoot, 'entry.mjs'), '');
  await writeFile(join(badRoot, 'protocol.json'), JSON.stringify({
    version: 1,
    repository: 'example/team',
    runtime: {nodeMajor: 24, nodeMinMinor: 11},
    instructions: ['AGENTS.md'],
    capabilities: {
      bad: {
        context: 'interactive',
        description: 12345,
        argv: ['entry.mjs'],
        options: [],
        documents: ['AGENTS.md'],
      },
    },
  }));
  await assert.rejects(manifest(badRoot, 'https://github.com/example/team.git'), /Invalid capability description/);
});

test('health alias falls back to doctor capability transparently', async () => {
  const legacyProtocol = {
    version: 1,
    repository: 'example/team',
    runtime: {nodeMajor: 24, nodeMinMinor: 11},
    instructions: ['AGENTS.md'],
    capabilities: {
      doctor: {
        context: 'interactive',
        argv: ['entry.mjs'],
        options: [],
        documents: ['AGENTS.md'],
      },
    },
  };
  const f = await fixture(legacyProtocol);
  const run = await operateReal(f.wb, 'run', 'Team', 'health', [], () => {});
  assert.equal(run.status, 'complete');
  assert.equal(run.stdout.trim(), 'HEALTH_OK');
});

test('CLI operates with unified flags (--health, --list, --sync, --status)', async () => {
  const f = await fixture();

  // Run --health via child process CLI
  const healthOut = execFileSync(process.execPath, [LINKED_REPO_SCRIPT, '--health'], {cwd: f.wb, encoding: 'utf8'});
  const healthJson = JSON.parse(healthOut);
  assert.equal(healthJson.status, 'complete');
  assert.equal(healthJson.stdout.trim(), 'HEALTH_OK');

  // Run --list via child process CLI
  const listOut = execFileSync(process.execPath, [LINKED_REPO_SCRIPT, '--list'], {cwd: f.wb, encoding: 'utf8'});
  const listJson = JSON.parse(listOut);
  assert.equal(listJson.status, 'complete');

  // Run bare / --status via child process CLI
  const statusOut = execFileSync(process.execPath, [LINKED_REPO_SCRIPT, '--status'], {cwd: f.wb, encoding: 'utf8'});
  const statusJson = JSON.parse(statusOut);
  assert.equal(statusJson.ready, true);

  // Run bare (no arguments)
  const bareOut = execFileSync(process.execPath, [LINKED_REPO_SCRIPT], {cwd: f.wb, encoding: 'utf8'});
  const bareJson = JSON.parse(bareOut);
  assert.equal(bareJson.ready, true);
});
