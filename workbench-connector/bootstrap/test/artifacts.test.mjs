import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connect, status, update} from '../connect.mjs';
import {resolveRealOversoul} from './_paths.mjs';

const REAL_OVERSOUL = resolveRealOversoul(dirname(fileURLToPath(import.meta.url)));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'artifacts-test-'));
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

test('a duplicate top-level key in the Antigravity MCP file is surfaced, not silently resolved', async () => {
  const f = await fixture();
  await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  // The bug this reproduces: JSON.parse silently keeps only the last "mcpServers" key.
  await writeFile(join(f.wb, '.agents', 'mcp_config.json'), '{"mcpServers":{"oracle-v2":{}},"mcpServers":{"notion":{"serverUrl":"https://mcp.notion.com/mcp"}}}');

  const s = await status({workbench: f.wb, name: 'Team', oversoulPath: REAL_OVERSOUL});
  const entry = s.artifacts.find(a => a.step === 'mcp:antigravity');
  assert.equal(entry.action, 'blocked', JSON.stringify(entry));
  assert.match(entry.detail.reason, /duplicate|written 2 times/i);

  const before = await readFile(join(f.wb, '.agents', 'mcp_config.json'), 'utf8');
  const result = await update({workbench: f.wb, name: 'Team', oversoulPath: REAL_OVERSOUL, yes: true});
  assert.equal(result.status, 'blocked', JSON.stringify(result));
  // Nothing else was touched either -- a blocked artifact stops the whole run.
  assert.equal(await readFile(join(f.wb, '.agents', 'mcp_config.json'), 'utf8'), before);
});

test('a human edit to CLAUDE.md is preserved, not blocking, since that artifact opts into preserve', async () => {
  const f = await fixture();
  await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  await writeFile(join(f.wb, 'CLAUDE.md'), 'Some hand-written project notes.\n');

  const result = await update({workbench: f.wb, name: 'Team', oversoulPath: REAL_OVERSOUL, clients: ['claude', 'codex', 'copilot'], yes: true});
  assert.equal(result.status, 'complete', JSON.stringify(result));
  const claudeMd = await readFile(join(f.wb, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /Some hand-written project notes/);
});

test('the claude-hook entry preserves an unrelated PreToolUse matcher already in settings.json', async () => {
  const f = await fixture();
  await mkdir(join(f.wb, '.claude'), {recursive: true});
  await writeFile(join(f.wb, '.claude', 'settings.json'), JSON.stringify({permissions: {defaultMode: 'auto'}, hooks: {PreToolUse: [{matcher: 'SomeOtherTool', hooks: [{type: 'command', command: 'node other-hook.mjs'}]}]}}));

  await connect({repoCwd: f.primary, workbench: f.wb, name: 'Team', dir: 'Team', oversoulPath: REAL_OVERSOUL, fetchRemote: f.fetchRemote, yes: true});
  const settings = JSON.parse(await readFile(join(f.wb, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.ok(settings.hooks.PreToolUse.some(h => h.matcher === 'SomeOtherTool'));
  assert.ok(settings.hooks.PreToolUse.some(h => h.hooks[0].command === 'node scripts/guardrail-check.mjs'));
  assert.equal(settings.permissions.defaultMode, 'auto');
});
