import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, realpath, stat, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connect, status, verify, update} from '../connect.mjs';
import {verifySync} from '../verify-sync.mjs';
import {inspect as inspectOversoul} from '../../oversoul/scripts/linked-repo.mjs';

const REAL_OVERSOUL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'oversoul');
const CONNECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'connect-test-')));
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
  // A real workbench is itself a git repo, so the .gitignore step has something to act on.
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

test('a dry run reports the full plan and mutates nothing', async () => {
  const f = await fixture();
  const plan = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote});
  assert.equal(plan.status, 'planned', JSON.stringify(plan));
  const stepNames = plan.steps.map(s => s.step).sort();
  assert.deepEqual(stepNames, ['branch', 'claude-md', 'contract', 'gitignore', 'install', 'link', 'mcp:.codex/config.toml', 'mcp:.mcp.json', 'mcp:.vscode/mcp.json', 'registry', 'self-verify', 'worktree']);
  assert.equal(await exists(join(f.wb, 'AGENTS.md')), false);
  assert.equal(await exists(join(f.wb, '.linked-repos.json')), false);
  assert.equal(await exists(join(f.wb, 'Team')), false);
});

test('a full connect run wires worktree, link, registry, skill, contract, and MCP', async () => {
  const f = await fixture();
  const result = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  assert.equal(result.status, 'connected', JSON.stringify(result, null, 2));

  const registered = git(f.primary, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
  const registeredReal = await Promise.all(registered.map(l => realpath(l.slice(9))));
  assert.ok(registeredReal.includes(await realpath(result.worktree)), JSON.stringify(registeredReal));
  assert.equal(await realpath(join(f.wb, 'Team')), await realpath(result.worktree));

  const registry = JSON.parse(await readFile(join(f.wb, '.linked-repos.json'), 'utf8'));
  assert.deepEqual(registry.targets.Team, {path: 'Team', remote: 'https://github.com/example/team.git', branch: result.branch, upstream: 'origin/main'});

  const agents = await readFile(join(f.wb, 'AGENTS.md'), 'utf8');
  assert.match(agents, /oversoul:linked-repository:begin/);
  assert.match(agents, /Team/);
  assert.equal(await readFile(join(f.wb, 'CLAUDE.md'), 'utf8'), '@./AGENTS.md\n');

  assert.equal(await exists(join(f.wb, '.claude', 'skills', 'oversoul', 'SKILL.md')), true);
  assert.equal(await exists(join(f.wb, '.agents', 'skills', 'oversoul', 'SKILL.md')), true);
  assert.equal(await exists(join(f.wb, '.github', 'prompts', 'oversoul.prompt.md')), true);

  const mcp = JSON.parse(await readFile(join(f.wb, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.notion, {type: 'http', url: 'https://mcp.notion.com/mcp'});
  const vscode = JSON.parse(await readFile(join(f.wb, '.vscode', 'mcp.json'), 'utf8'));
  assert.deepEqual(vscode.servers.notion, {type: 'http', url: 'https://mcp.notion.com/mcp'});
  const codexConfig = await readFile(join(f.wb, '.codex', 'config.toml'), 'utf8');
  assert.match(codexConfig, /\[mcp_servers\.notion\]/);

  const gitignore = await readFile(join(f.wb, '.gitignore'), 'utf8');
  assert.match(gitignore, /\/Team\//);
  assert.match(gitignore, /\.linked-repos\.json/);

  const installStep = result.steps.find(s => s.step === 'install');
  assert.equal(installStep.action, 'complete', JSON.stringify(installStep));
  // Self-verify spawns a real subprocess running the installed linked-repo.mjs, which does its
  // own real `git fetch --no-tags origin` — it has no way to receive this test's injected
  // fetchRemote closure. Against the fixture's fake https://github.com/example/team.git that
  // fetch genuinely fails, which is the one honest limitation of testing this hermetically; the
  // client correctly reports it as a single non-fatal diagnostic rather than crashing, and
  // everything else it can determine locally (branch, upstream, cleanliness, protocol) is still
  // verified correct.
  const verifyStep = result.steps.find(s => s.step === 'self-verify');
  assert.equal(verifyStep.action, 'blocked', JSON.stringify(verifyStep));
  assert.deepEqual(verifyStep.detail.diagnostics, ['Fetch failed; remote state is unverified']);
  assert.equal(verifyStep.detail.branch, result.branch);
  assert.equal(verifyStep.detail.upstream, 'origin/main');
  assert.equal(verifyStep.detail.changes, '');
  assert.equal(verifyStep.detail.protocol.repository, 'example/team');

  // Confirm the wiring is actually correct end-to-end, not just "correct except for one
  // diagnostic": call the client's own inspect() in-process with the fetch injected, the same
  // way the real subprocess would resolve everything if its fetch could reach a real remote.
  const withRealFetch = await inspectOversoul(f.wb, 'Team', true, f.fetchRemote);
  assert.equal(withRealFetch.ready, true, JSON.stringify(withRealFetch));
});

test('a second run against an already-connected workbench is fully unchanged', async () => {
  const f = await fixture();
  await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  const agentsBefore = await readFile(join(f.wb, 'AGENTS.md'), 'utf8');
  const mcpBefore = await readFile(join(f.wb, '.mcp.json'), 'utf8');

  const second = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  assert.equal(second.status, 'connected', JSON.stringify(second, null, 2));
  for (const step of second.steps) {
    if (step.step === 'install') { assert.equal(step.action, 'complete'); continue; }
    // 'blocked' here reflects the same fetch-needs-real-network limitation as the previous
    // test, not a regression between the first and second run.
    if (step.step === 'self-verify') { assert.equal(step.action, 'blocked'); continue; }
    assert.equal(step.action, 'unchanged', JSON.stringify(step));
  }
  const installOutcomes = second.steps.find(s => s.step === 'install').detail.outcomes;
  assert.ok(installOutcomes.every(o => o.action === 'unchanged'), JSON.stringify(installOutcomes));

  assert.equal(await readFile(join(f.wb, 'AGENTS.md'), 'utf8'), agentsBefore);
  assert.equal(await readFile(join(f.wb, '.mcp.json'), 'utf8'), mcpBefore);
});

test('an unrelated existing registry target survives linking a new one', async () => {
  const f = await fixture();
  await writeFile(join(f.wb, '.linked-repos.json'), JSON.stringify({version: 1, targets: {Other: {path: 'Other', remote: 'https://github.com/example/other.git', branch: 'workbench', upstream: 'origin/main'}}}));
  const result = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  assert.equal(result.status, 'connected', JSON.stringify(result, null, 2));
  const registry = JSON.parse(await readFile(join(f.wb, '.linked-repos.json'), 'utf8'));
  assert.deepEqual(registry.targets.Other, {path: 'Other', remote: 'https://github.com/example/other.git', branch: 'workbench', upstream: 'origin/main'});
  assert.ok(registry.targets.Team);
});

test('an occupied, non-worktree link or worktree path blocks without mutating anything', async () => {
  const f = await fixture();
  const occupied = join(dirname(f.primary), 'primary-worktrees', 'wb');
  await mkdir(occupied, {recursive: true});
  await writeFile(join(occupied, 'unexpected.txt'), 'not a worktree');
  const result = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', worktreePath: occupied, oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  assert.equal(result.status, 'blocked', JSON.stringify(result, null, 2));
  const worktreeStep = result.steps.find(s => s.step === 'worktree');
  assert.equal(worktreeStep.action, 'blocked');
  assert.equal(await exists(join(f.wb, '.linked-repos.json')), false);
  assert.equal(await exists(join(f.wb, 'AGENTS.md')), false);
  assert.equal(await exists(join(f.wb, 'Team')), false);
});

test('a conflicting registry entry under the same name blocks and is never rewritten', async () => {
  const f = await fixture();
  const conflicting = {path: 'Team', remote: 'https://github.com/example/other.git', branch: 'workbench/x', upstream: 'origin/main'};
  await writeFile(join(f.wb, '.linked-repos.json'), JSON.stringify({version: 1, targets: {Team: conflicting}}));
  const result = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  assert.equal(result.status, 'blocked', JSON.stringify(result, null, 2));
  const registry = JSON.parse(await readFile(join(f.wb, '.linked-repos.json'), 'utf8'));
  assert.deepEqual(registry.targets.Team, conflicting);
});

test('a pre-existing .mcp.json keeps other servers and a differing notion entry is preserved, not overwritten', async () => {
  const f = await fixture();
  await writeFile(join(f.wb, '.mcp.json'), JSON.stringify({mcpServers: {other: {type: 'http', url: 'https://example.com/mcp'}, notion: {type: 'http', url: 'https://not-the-real-one.example/mcp'}}}));
  const result = await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  assert.equal(result.status, 'connected', JSON.stringify(result, null, 2));
  const mcp = JSON.parse(await readFile(join(f.wb, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.other, {type: 'http', url: 'https://example.com/mcp'});
  assert.deepEqual(mcp.mcpServers.notion, {type: 'http', url: 'https://not-the-real-one.example/mcp'});
  const mcpStep = result.steps.find(s => s.step === 'mcp:.mcp.json');
  assert.equal(mcpStep.action, 'preserved');
});

test('status and verify report a connected workbench without mutating it', async () => {
  const f = await fixture();
  await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  const before = await readFile(join(f.wb, '.linked-repos.json'), 'utf8');
  // Same real-fetch limitation as above: status/verify shell out to the installed client, which
  // does its own real fetch against the fixture's unreachable fake GitHub URL.
  const s = await status({workbench: f.wb, name: 'Team'});
  assert.equal(s.status, 'reported');
  assert.deepEqual(s.detail.diagnostics, ['Fetch failed; remote state is unverified']);
  const v = await verify({workbench: f.wb, name: 'Team'});
  assert.equal(v.status, 'blocked');
  assert.equal(await readFile(join(f.wb, '.linked-repos.json'), 'utf8'), before);
});

test('status on an unregistered workbench says so rather than failing',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'connect-status-')));
  const s=await status({workbench:root});
  assert.equal(s.status,'unregistered');
});

test('verify-sync reports no drift against itself and reports differences after a change',async()=>{
  const inSync=await verifySync(REAL_OVERSOUL,REAL_OVERSOUL);
  assert.equal(inSync.inSync,true,JSON.stringify(inSync));

  const root=await realpath(await mkdtemp(join(tmpdir(),'verify-sync-')));
  const vendored=join(root,'vendored');
  await mkdir(vendored,{recursive:true});
  // A trivial single-file vendored copy is enough to exercise added/removed/changed detection
  // without duplicating the whole real package into a temp directory for this test.
  await writeFile(join(vendored,'SKILL.md'),'stale content');
  await writeFile(join(vendored,'EXTRA.md'),'only in vendored');
  const drift=await verifySync(REAL_OVERSOUL,vendored);
  assert.equal(drift.inSync,false);
  assert.ok(drift.changed.includes('SKILL.md'));
  assert.ok(drift.added.includes('EXTRA.md'));
  assert.ok(drift.removed.length>0);
});

test('the connector source contains no literal reference to this specific shared repository or its owner',async()=>{
  const literals=[/Soniferous-Shrimp/,/Bossax/];
  async function scan(dir){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      if(entry.name==='test')continue;
      const full=join(dir,entry.name);
      if(entry.isDirectory()){await scan(full);continue;}
      if(!/\.(mjs|md)$/.test(entry.name))continue;
      const text=await readFile(full,'utf8');
      for(const re of literals){
        assert.equal(re.test(text),false,`${full} contains a literal reference to ${re}`);
      }
    }
  }
  await scan(CONNECTOR_ROOT);
});
