import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, stat, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSkill} from '../../workbench-connector/shared/skill-install.mjs';
import {probe} from '../../workbench-connector/shared/artifacts/tree.mjs';

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function makeSkill(root, version) {
  const dir = join(root, 'skill-' + version);
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'SKILL.md'), '---\nname: demo\n---\n# Demo\n');
  return dir;
}

test('shared installer is agnostic to which skill calls it: fresh install then forward upgrade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-install-'));
  const project = join(root, 'project');
  const v1 = await makeSkill(root, '0.1.0');
  const v2 = await makeSkill(root, '0.2.0');
  const pathFor = () => join(project, '.claude', 'skills', 'demo');

  let results = await installSkill({skillId: 'demo', source: v1, sourceVersion: '0.1.0', project, pathFor, names: ['claude'], allowDowngrade: false});
  assert.equal(results[0].action, 'installed');
  assert.equal(await exists(join(project, '.claude', 'skills', 'demo', 'SKILL.md')), true);

  results = await installSkill({skillId: 'demo', source: v2, sourceVersion: '0.2.0', project, pathFor, names: ['claude'], allowDowngrade: false});
  assert.equal(results[0].action, 'upgraded');
  assert.equal(JSON.parse(await readFile(join(project, '.claude', 'skills', 'demo', 'engine.json'), 'utf8')).engineRelease, '0.2.0');

  results = await installSkill({skillId: 'demo', source: v1, sourceVersion: '0.1.0', project, pathFor, names: ['claude'], allowDowngrade: false});
  assert.equal(results[0].action, 'blocked');
  assert.equal(results[0].failed, true);
});

test('legacy skill metadata migrates once to the engine release model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-install-'));
  const source = await makeSkill(root, '0.1.0');
  const target = join(root, 'installed');
  await mkdir(target);
  await writeFile(join(target, 'SKILL.md'), '---\nname: demo\nmetadata:\n  version: 2.1.1\n---\n# Demo\n');

  const [result] = await installSkill({skillId: 'demo', source, sourceVersion: '0.1.0', project: root, pathFor: () => target, names: ['workbench'], allowDowngrade: false});
  assert.equal(result.action, 'migrated');
  assert.equal(JSON.parse(await readFile(join(target, 'engine.json'), 'utf8')).engineRelease, '0.1.0');
});

test('a failed replacement restores the prior installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-install-'));
  const target = join(root, 'installed');
  const v1 = await makeSkill(root, '0.1.0');
  const v2 = await makeSkill(root, '0.2.0');
  const options = {skillId: 'demo', project: root, pathFor: () => target, names: ['workbench'], allowDowngrade: false};
  await installSkill({...options, source: v1, sourceVersion: '0.1.0'});
  let moves = 0;
  const failSecondMove = async (from, to) => {
    moves++;
    if (moves === 2) throw new Error('simulated replacement failure');
    await rename(from, to);
  };

  await assert.rejects(installSkill({...options, source: v2, sourceVersion: '0.2.0', renamePath: failSecondMove}), /simulated replacement failure/);
  assert.equal(JSON.parse(await readFile(join(target, 'engine.json'), 'utf8')).engineRelease, '0.1.0');
});

test('tree probe permits an explicitly allowed downgrade and rejects another skill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-install-'));
  const target = join(root, 'installed');
  await mkdir(target);
  await writeFile(join(target, 'SKILL.md'), '---\nname: demo\n---\n# Demo\n');
  await writeFile(join(target, 'engine.json'), '{"engineRelease":"0.2.0"}\n');

  const entry = {skillId: 'demo', dest: 'installed'};
  assert.equal((await probe({workbenchRoot: root, packageVersion: '0.1.0', allowDowngrade: true}, entry)).state, 'ahead');
  assert.equal((await probe({workbenchRoot: root, packageVersion: '0.1.0', allowDowngrade: false}, {...entry, skillId: 'other'})).state, 'locally-modified');
});

test('skill install stamps bundleHash and sourceCommit and upgrades when stamps differ', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-install-stamps-'));
  const project = join(root, 'project');
  const s1 = await makeSkill(root, '0.1.0');
  const pathFor = () => join(project, '.claude', 'skills', 'demo');

  let results = await installSkill({
    skillId: 'demo',
    source: s1,
    sourceVersion: '0.1.0',
    bundleHash: 'sha256:1111',
    sourceCommit: 'commit-1',
    project,
    pathFor,
    names: ['claude'],
    allowDowngrade: false,
  });
  assert.equal(results[0].action, 'installed');
  let installed = JSON.parse(await readFile(join(project, '.claude', 'skills', 'demo', 'engine.json'), 'utf8'));
  assert.equal(installed.engineRelease, '0.1.0');
  assert.equal(installed.bundleHash, 'sha256:1111');
  assert.equal(installed.sourceCommit, 'commit-1');

  results = await installSkill({
    skillId: 'demo',
    source: s1,
    sourceVersion: '0.1.0',
    bundleHash: 'sha256:1111',
    sourceCommit: 'commit-1',
    project,
    pathFor,
    names: ['claude'],
    allowDowngrade: false,
  });
  assert.equal(results[0].action, 'unchanged');

  results = await installSkill({
    skillId: 'demo',
    source: s1,
    sourceVersion: '0.1.0',
    bundleHash: 'sha256:2222',
    sourceCommit: 'commit-2',
    project,
    pathFor,
    names: ['claude'],
    allowDowngrade: false,
  });
  assert.equal(results[0].action, 'upgraded');
  installed = JSON.parse(await readFile(join(project, '.claude', 'skills', 'demo', 'engine.json'), 'utf8'));
  assert.equal(installed.engineRelease, '0.1.0');
  assert.equal(installed.bundleHash, 'sha256:2222');
  assert.equal(installed.sourceCommit, 'commit-2');
});
