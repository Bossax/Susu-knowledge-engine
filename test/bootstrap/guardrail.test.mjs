import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const GUARDRAIL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'workbench-connector', 'bootstrap', 'payload', 'guardrail-check.mjs');

async function workbenchWithTargets(targets) {
  const root = await mkdtemp(join(tmpdir(), 'guardrail-test-'));
  await writeFile(join(root, '.linked-repos.json'), JSON.stringify({version: 1, targets}));
  return root;
}

function run(cwd, payload) {
  const result = spawnSync(process.execPath, [GUARDRAIL], {cwd, input: JSON.stringify(payload), encoding: 'utf8'});
  let stdout; try { stdout = JSON.parse(result.stdout); } catch { stdout = {raw: result.stdout}; }
  return {status: result.status, stdout, stderr: result.stderr};
}

test('derives its deny pattern from .linked-repos.json and denies a matching path with the gate closed', async () => {
  const root = await workbenchWithTargets({Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'}});
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: 'Shared-Knowledge/AGENTS.md'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(r));
  assert.match(r.stdout.hookSpecificOutput.permissionDecisionReason, /Shared-Knowledge/);
});

test('a second registered target is guarded too, named correctly in the deny reason', async () => {
  const root = await workbenchWithTargets({
    Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'},
    Other: {path: 'Other-Repo', remote: 'https://github.com/example/other.git', branch: 'workbench/y', upstream: 'origin/main'},
  });
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Edit', tool_input: {file_path: 'Other-Repo/docs/x.md'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(r));
  assert.match(r.stdout.hookSpecificOutput.permissionDecisionReason, /Other-Repo/);
});

test('allows a path that touches no registered target', async () => {
  const root = await workbenchWithTargets({Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'}});
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: 'src/index.mjs'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'allow', JSON.stringify(r));
});

test('allows running linked-repo.mjs or connect.mjs themselves even though their path mentions the target', async () => {
  const root = await workbenchWithTargets({Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'}});
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Bash', tool_input: {command: 'node .agents/skills/oversoul/scripts/linked-repo.mjs inspect --target Shrimp'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'allow', JSON.stringify(r));
});

test('allows a matching path once an unexpired gate lease exists', async () => {
  const root = await workbenchWithTargets({Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'}});
  await mkdir(join(root, '.agents'), {recursive: true});
  await writeFile(join(root, '.agents', 'oversoul-gate.json'), JSON.stringify({target: 'Shrimp', expiresAt: new Date(Date.now() + 3600_000).toISOString()}));
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: 'Shared-Knowledge/AGENTS.md'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'allow', JSON.stringify(r));
});

test('denies again once the lease has expired', async () => {
  const root = await workbenchWithTargets({Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'}});
  await mkdir(join(root, '.agents'), {recursive: true});
  await writeFile(join(root, '.agents', 'oversoul-gate.json'), JSON.stringify({target: 'Shrimp', expiresAt: new Date(Date.now() - 1000).toISOString()}));
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: 'Shared-Knowledge/AGENTS.md'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(r));
});

test('guards nothing when no targets are registered yet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardrail-test-'));
  const r = run(root, {hookEventName: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: 'Shared-Knowledge/AGENTS.md'}});
  assert.equal(r.stdout.hookSpecificOutput.permissionDecision, 'allow', JSON.stringify(r));
});

test('the Claude Code contract (stderr + exit 2) still works for a payload without hookEventName', async () => {
  const root = await workbenchWithTargets({Shrimp: {path: 'Shared-Knowledge', remote: 'https://github.com/example/shrimp.git', branch: 'workbench/x', upstream: 'origin/main'}});
  const r = run(root, {tool_name: 'Read', tool_input: {file_path: 'Shared-Knowledge/AGENTS.md'}});
  assert.equal(r.status, 2, JSON.stringify(r));
  assert.match(r.stderr, /Shared-Knowledge/);
});
