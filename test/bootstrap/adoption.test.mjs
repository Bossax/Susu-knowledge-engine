import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connect, status} from '../../workbench-connector/bootstrap/connect.mjs';

const REAL_OVERSOUL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'workbench-connector', 'oversoul');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'adoption-test-'));
  const remote = join(root, 'remote.git');
  const primary = join(root, 'primary');
  const wb = join(root, 'wb');
  await mkdir(primary, {recursive: true});
  await mkdir(wb, {recursive: true});
  git(root, 'init', '--bare', remote);
  git(primary, 'init', '-b', 'main');
  git(primary, 'config', 'user.name', 'Test');
  git(primary, 'config', 'user.email', 'test@example.invalid');
  git(primary, 'config', 'commit.gpgsign', 'false');
  git(wb, 'init', '-b', 'main');
  git(wb, 'config', 'user.name', 'Test');
  git(wb, 'config', 'user.email', 'test@example.invalid');
  git(wb, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(primary, 'AGENTS.md'), 'Test protocol');
  await writeFile(join(primary, 'protocol.json'), JSON.stringify({version: 1, repository: 'example/team', runtime: {nodeMajor: 24, nodeMinMinor: 11}, instructions: ['AGENTS.md'], capabilities: {}}));
  git(primary, 'add', '.');
  git(primary, 'commit', '-m', 'fixture');
  git(primary, 'remote', 'add', 'origin', remote);
  git(primary, 'push', '-u', 'origin', 'main');
  git(primary, 'remote', 'set-url', 'origin', 'https://github.com/example/team.git');
  const fetchRemote = (cwd) => git(cwd, 'fetch', '--no-tags', remote, 'refs/heads/main:refs/remotes/origin/main');
  return {root, remote, primary, wb, fetchRemote};
}

test('a workbench connected before the manifest existed reports real states, never unknown', async () => {
  const f = await fixture();
  await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  // Simulate "connected before this manifest existed": remove the state file the new mechanism
  // would have written, and go back to a pre-fix SKILL.md wording so the contract block reads
  // as genuinely one version behind, the way a real pre-2.0.0 workbench would.
  await mkdir(join(f.wb, '.agents'), {recursive: true});
  const {rm} = await import('node:fs/promises');
  await rm(join(f.wb, '.agents', 'oversoul-artifacts.json'), {force: true});

  const s = await status({workbench: f.wb, name: 'Team', oversoulPath: REAL_OVERSOUL, clients: ['claude', 'codex', 'copilot']});
  assert.equal(s.status, 'reported', JSON.stringify(s));
  for (const a of s.artifacts) {
    assert.notEqual(a.action, 'unknown', JSON.stringify(a));
  }
  // Containment-based artifacts need no state file at all and must still read as current.
  const gitignore = s.artifacts.find(a => a.step === 'gitignore');
  assert.equal(gitignore.action, 'unchanged', JSON.stringify(gitignore));
  const mcp = s.artifacts.find(a => a.step === 'mcp:claude');
  assert.equal(mcp.action, 'unchanged', JSON.stringify(mcp));
});
